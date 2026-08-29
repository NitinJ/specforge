// Cross-spec links, rewritten for the address space a share is served in.
//
// A spec links to its neighbours as `/spec/<id>`, which is an address on the
// daemon. The gateway does not serve that path — it serves `/p/<token>/spec/<id>`
// and `/s/<token>`, and everything else falls to the default deny — so every one
// of those links was a 404 for a reviewer, and a project of linked specs was
// readable one page at a time.
//
// Done at serve time and never on disk. The file keeps saying what its author
// wrote, which is the same rule the review layer already follows: what a share
// needs is true of that response, not of the document.
//
// The link is followed only when the reader already has the capability to reach
// it. Inside a shared project that is membership, which the project route
// already checks per request, so a rewrite grants nothing new. Between two
// separately shared specs it is not: a token is deliberately never derived from
// a spec id, so holding one published spec's link says nothing about any other,
// and rewriting across them would hand out access nobody granted.

/** Hosts that mean "this daemon". An href to anywhere else is somebody's link. */
const OURS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * The spec id an href names, or null when it does not name one of ours.
 *
 * `https://example.com/spec/x` is a link to example.com that happens to look
 * like ours, and rewriting it would break a working link to make a broken one
 * work.
 *
 * @returns {{id:string, suffix:string}|null} suffix is the `#anchor` or `?query`
 */
export function specLinkTarget(href) {
  const raw = String(href || '').trim();
  if (!raw) return null;

  let rest = raw;
  const origin = rest.match(/^https?:\/\/([^/]+)(\/.*)$/i);
  if (origin) {
    const host = origin[1].replace(/:\d+$/, '').toLowerCase();
    if (!OURS.has(host)) return null;
    rest = origin[2];
  } else if (!rest.startsWith('/spec/')) {
    // Anything else relative: an anchor on this page, a sibling path, a mailto.
    return null;
  }

  const m = rest.match(/^\/spec\/([\w-]+)([#?].*)?$/);
  return m ? { id: m[1], suffix: m[2] || '' } : null;
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rewrite every cross-spec link in a served page.
 *
 * @param {string} html
 * @param {object} o
 * @param {string|null} o.base path a reachable spec lives under, e.g.
 *   `/p/<token>`. Null when nothing is reachable, which is a single-spec share.
 * @param {(id:string) => boolean} [o.reachable] whether this reader may follow
 *   the link. Defaults to nothing being reachable.
 * @returns {string}
 */
/**
 * One attribute: a name, and optionally a value in any of HTML's three quotings.
 *
 * All three because `specforge import` takes a file as it finds it, and a spec
 * in the store can carry any of them.
 */
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/gy;

/**
 * Find the href attribute by walking the attributes, not by searching the text.
 *
 * Searching finds the first thing SHAPED like an href, and an attribute value is
 * allowed to contain that shape: in `<a title="see href=/spec/x" href="/spec/y">`
 * a search edits the title and never sees the real href. That is the one failure
 * in this area that corrupts rather than degrades, so the blob is parsed instead.
 *
 * @returns {{start:number, end:number, value:string}|null}
 */
function findHref(attrs) {
  ATTR.lastIndex = 0;
  while (ATTR.lastIndex < attrs.length) {
    // Skip the whitespace between attributes; without this the sticky flag
    // stalls the moment it meets a space.
    const ws = /\s*/y;
    ws.lastIndex = ATTR.lastIndex;
    ws.exec(attrs);
    ATTR.lastIndex = ws.lastIndex;
    if (ATTR.lastIndex >= attrs.length) break;

    const start = ATTR.lastIndex;
    const m = ATTR.exec(attrs);
    // Anything this cannot tokenize (a stray quote, a bare `=`) ends the walk.
    // Guessing past it is how a parser starts editing the wrong attribute.
    if (!m) return null;
    if (m[1].toLowerCase() === 'href') {
      return { start, end: ATTR.lastIndex, value: m[2] ?? m[3] ?? m[4] ?? '' };
    }
  }
  return null;
}

/**
 * An opening `<a>` tag, scanned attribute-aware.
 *
 * `[^>]*` would be shorter and stops at the first `>`, which a quoted attribute
 * value is allowed to contain (`title="draft > done"`). The href after it would
 * then never be seen. Alternating "anything but a quote or a bracket" with whole
 * quoted runs steps over those. No anchor in this store is written that way, and
 * the failure is graceful rather than corrupting, so this is a hole closed
 * because it is one line rather than because it was hurting.
 */
const OPEN_A = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi;

export function rewriteSpecLinks(html, { base = null, reachable = () => false } = {}) {
  return String(html).replace(OPEN_A, (tag, attrs, selfClose) => {
    const href = findHref(attrs);
    if (!href) return tag;
    const target = specLinkTarget(href.value);
    if (!target) return tag;

    // Spliced by position rather than by replacing the matched text: the same
    // text can appear twice in one tag, and a string replace edits whichever
    // came first.
    const before = attrs.slice(0, href.start);
    const after = attrs.slice(href.end);

    if (base && reachable(target.id)) {
      // Written back double-quoted whatever it arrived as. The value is escaped
      // here, so the quoting is this function's to choose, and one output form
      // is one fewer thing to get wrong.
      const to = escapeAttr(`${base}/spec/${target.id}${target.suffix}`);
      return `<a${before}href="${to}"${after}${selfClose}>`;
    }

    // Unreachable: the href goes, so a click cannot land on a deny page, and the
    // id stays in an attribute the review layer styles and can name in a
    // message. Dropping the text instead would lose what the author wrote about
    // a spec the reader simply cannot open from here.
    return `<a${before}${after} data-sf-unshared="${escapeAttr(target.id)}"`
      + ` title="Not part of this share"${selfClose}>`;
  });
}

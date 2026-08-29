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
export function rewriteSpecLinks(html, { base = null, reachable = () => false } = {}) {
  return String(html).replace(/<a\b([^>]*)>/gi, (tag, attrs) => {
    const href = attrs.match(/\shref="([^"]*)"/i);
    if (!href) return tag;
    const target = specLinkTarget(href[1]);
    if (!target) return tag;

    if (base && reachable(target.id)) {
      return `<a${attrs.replace(href[0], ` href="${escapeAttr(`${base}/spec/${target.id}${target.suffix}`)}"`)}>`;
    }

    // Unreachable: the href goes, so a click cannot land on a deny page, and the
    // id stays in an attribute the review layer styles and can name in a
    // message. Dropping the text instead would lose what the author wrote about
    // a spec the reader simply cannot open from here.
    const without = attrs.replace(href[0], '');
    return `<a${without} data-sf-unshared="${escapeAttr(target.id)}"`
      + ' title="Not part of this share">';
  });
}

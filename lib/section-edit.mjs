// Section splice for the inline section editor. The daemon serves a spec with the
// review layer injected, but the browser edits CLEAN source read from disk (the
// served DOM carries review-chrome classes/attributes we must never persist), so
// these operate on the raw on-disk spec.html.
//
// Only a section's INNER html is read/replaced — the <section id="…" class="…">
// wrapper is left byte-for-byte untouched, so the id (which anchors comments +
// the TOC) and the section's classes can never be edited away through this path.
//
// The scan is a tiny tag walker over <section>/</section> boundaries with depth
// tracking, so nested sections resolve to the correct matching close. Two hazards
// that would otherwise misparse:
//   - a `>` inside a quoted attribute value on the open tag → the tag regex skips
//     over quoted spans, so only an unquoted `>` ends the tag;
//   - a literal `<section>`/`</section>` inside a comment or a raw-text element
//     (pre/code/script/style), e.g. a spec that documents HTML → those regions are
//     length-preserving-masked before the scan so their offsets still map 1:1 to
//     the original, but their contents can't be mistaken for structural markup.

// Open tag: attribute values may be quoted and contain '>'; only an unquoted '>'
// closes it. Close tag: <​/section>.
const TAG_RE = /<section\b(?:"[^"]*"|'[^']*'|[^>"'])*>|<\/section\s*>/gi;
const ID_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
// Regions whose inner text must NOT be scanned for section tags: HTML comments and
// the raw content of pre/code/script/style.
const RAW_RE = /<!--[\s\S]*?-->|<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** The id attribute of a `<section …>` open tag, or null. */
function openTagId(tag) {
  const m = tag.match(ID_RE);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

/** Same-length copy with comment / raw-element bodies blanked to spaces. */
function maskRaw(html) {
  return html.replace(RAW_RE, (m) => ' '.repeat(m.length));
}

/**
 * Locate `<section id="sectionId">…</section>` and return the offsets
 * { openEnd, closeStart } bounding its inner html, or null if not found.
 * Depth-aware: once the target opens, nested sections increment/decrement a
 * counter so the matching (not the first) close is chosen. Offsets are computed
 * on a raw-masked copy but index the original document (mask preserves length).
 */
function locate(html, sectionId) {
  const scan = maskRaw(html);
  TAG_RE.lastIndex = 0;
  let openEnd = -1;
  let depth = 0;
  let m;
  while ((m = TAG_RE.exec(scan))) {
    const isClose = m[0].charAt(1) === '/';
    if (openEnd === -1) {
      // Still hunting for the target's opening tag.
      if (!isClose && openTagId(m[0]) === sectionId) {
        openEnd = TAG_RE.lastIndex;
        depth = 1;
      }
      continue;
    }
    // Inside the target — track nesting to find its own close.
    if (isClose) {
      depth -= 1;
      if (depth === 0) return { openEnd, closeStart: m.index };
    } else {
      depth += 1;
    }
  }
  return null;
}

/** The inner html of `<section id="sectionId">`, or null if the section is absent. */
export function getSectionInner(html, sectionId) {
  const loc = locate(html, sectionId);
  return loc ? html.slice(loc.openEnd, loc.closeStart) : null;
}

/**
 * Replace the inner html of `<section id="sectionId">` with `newInner`, keeping
 * the wrapper and every other byte of the document intact. Returns the new
 * document, or null if the section is absent.
 */
export function replaceSectionInner(html, sectionId, newInner) {
  const loc = locate(html, sectionId);
  if (!loc) return null;
  return html.slice(0, loc.openEnd) + newInner + html.slice(loc.closeStart);
}

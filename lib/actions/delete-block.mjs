// Remove one block from a spec.
//
// The other half of Delete. An aside is identified by its id, because SpecForge
// wrote it; a block is the reader's own writing and has no id in the document at
// all — its identity lives in the browser's block registry, keyed to a DOM the
// server cannot see.
//
// So the client names it the way a reader would: this tag, in this section, with
// this text. The server finds exactly one match or refuses. Refusing is the
// important half. A near-miss means the document moved between the page loading
// and the click, and cutting whatever is nearest would remove a paragraph the
// reader never looked at, with nothing in the store to get it back from.
//
// What is NOT sent is markup. That is the line the section editor crossed in
// v0.2.47 and this does not: everything here is a description of something the
// document already contains.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';
import { sectionRange, endOfElement, escapeRe } from './section-span.mjs';

/**
 * Tags that are never a block, whatever the client says.
 *
 * A denylist rather than a whitelist of block tags. Half the commentable
 * surfaces are components — `.panel`, `.callout`, `.card` and the injected
 * component classes — and every one of them is a `div`, so a whitelist of the
 * plain block tags refused a delete on the entries most likely to be deleted.
 * What makes this safe is the exact-text match inside one section and the
 * refusal to act on more than one hit, not the tag.
 *
 * These are refused because they hold the document rather than sit in it: a
 * request naming one is either confused or trying to take a section out through
 * a route meant for its contents.
 */
const NOT_BLOCKS = ['html', 'body', 'head', 'main', 'section', 'article', 'nav', 'script', 'style'];

/**
 * The entities a spec actually carries, decoded.
 *
 * The browser hands back `textContent`, which is decoded; the file holds the
 * source, which is not. Without this a paragraph containing `&amp;` or an
 * `&#8212;` never matches what the reader is looking at, and Delete answers 409
 * on a block nobody has touched. Numeric forms matter most: SpecForge's own
 * templates write `&#8212;` and `&#9776;` rather than the characters.
 */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', middot: '·', times: '×',
};
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // A code point outside the range is left as written rather than turned
      // into a replacement character, which would match nothing either way but
      // silently.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * Text as the reader sees it: tags dropped, entities decoded, runs of whitespace
 * collapsed.
 *
 * The same normalisation the client applies before sending, so "A
 * <strong>bold</strong> claim.", a paragraph wrapped over three indented lines,
 * and one written with `&amp;` all compare equal to what was on screen.
 */
export function plainText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Whether the file's text and the reader's text describe the same block.
 *
 * The table above is finite and the set of valid named entities is not, so
 * `&copy;` in a spec would leave an untouched block undeletable. Rather than
 * carry every name HTML defines, an entity this build does not recognise is
 * matched as a single character: it is still an entity, it still decodes to
 * something, and that something is one character wide.
 *
 * The cost is bounded in the right direction. A wildcard can only widen a match,
 * and a text that matches two blocks is already a refusal — so the worst case is
 * a delete that refuses, never one that removes the wrong paragraph.
 */
export function sameText(fileText, readerText) {
  if (fileText === readerText) return true;
  if (!/&[a-z][a-z0-9]*;/i.test(fileText)) return false;
  const pattern = fileText
    .split(/(&[a-z][a-z0-9]*;)/i)
    .map((part, i) => (i % 2 ? '.' : escapeRe(part)))
    .join('');
  return new RegExp(`^${pattern}$`, 'u').test(readerText);
}

/** Every `<tag>…</tag>` inside `html`, as {start, end}, depth-counted. */
function elementsOf(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const end = endOfElement(html, m.index + m[0].length, tag);
    if (end === -1) continue; // unclosed: not something to cut to
    out.push({ start: m.index, end });
    // Nested same-tag elements are found by the outer scan continuing past this
    // one's opening tag, so an <li> inside an <li> is still reachable.
  }
  return out;
}

/**
 * Cut one block out of a spec.
 *
 * @param {string} html the spec
 * @param {{section:string, tag:string, text:string}} what the reader pointed at
 * @returns {{html:string, section:string, tag:string}}
 * @throws when the section is missing, is a draft, or the block does not resolve
 *   to exactly one element
 */
export function deleteBlock(html, { section, tag, text } = {}) {
  const at = sectionRange(html, section);
  if (!at) throw new Error(`delete: no section ${JSON.stringify(section)} in this spec`);
  // A draft has its own delete, which removes the whole thing and its threads.
  // Cutting one block out of one leaves a half-answered draft that still reads
  // as awaiting an answer.
  if (getAttr(at.attrs, 'data-sf-aside')) {
    throw new Error(`delete: ${JSON.stringify(section)} is a draft; delete the draft itself instead`);
  }

  const lower = String(tag || '').toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(lower)) {
    throw new Error(`delete: ${JSON.stringify(tag)} is not a tag name`);
  }
  if (NOT_BLOCKS.includes(lower)) {
    throw new Error(`delete: <${lower}> holds the document rather than sitting in it`);
  }
  const want = plainText(text);
  if (!want) throw new Error('delete: the block text is required to identify it');

  const body = html.slice(at.inner, at.end);
  const hits = elementsOf(body, lower)
    .filter((e) => sameText(plainText(body.slice(e.start, e.end)), want));

  if (!hits.length) {
    throw new Error(
      `delete: no block <${lower}> in section ${JSON.stringify(section)} reads as ${JSON.stringify(want.slice(0, 60))}`,
    );
  }
  if (hits.length > 1) {
    // Position would break the tie and the reader cannot see which one it picked.
    throw new Error(
      `delete: that text matches ${hits.length} blocks in ${JSON.stringify(section)}; nothing was removed`,
    );
  }

  // Leading whitespace goes with it, so removing a paragraph leaves the file as
  // it was rather than with a widening gap.
  let start = at.inner + hits[0].start;
  while (start > at.inner && /\s/.test(html[start - 1])) start -= 1;
  return { html: html.slice(0, start) + html.slice(at.inner + hits[0].end), section, tag: lower };
}

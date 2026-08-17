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
import { sectionRange, endOfElement } from './section-span.mjs';

/** Tags a block can be, matching the browser's own list of plain-HTML blocks. */
const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'tr', 'td', 'th',
  'pre', 'blockquote', 'figure'];

/**
 * Text as the reader sees it: tags dropped, entities left alone, runs of
 * whitespace collapsed.
 *
 * The same normalisation the client applies before sending, so "A
 * <strong>bold</strong> claim." and a paragraph wrapped over three indented
 * lines both compare equal to what was on screen.
 */
export function plainText(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
  if (!BLOCK_TAGS.includes(lower)) {
    throw new Error(`delete: ${JSON.stringify(tag)} is not a block tag`);
  }
  const want = plainText(text);
  if (!want) throw new Error('delete: the block text is required to identify it');

  const body = html.slice(at.inner, at.end);
  const hits = elementsOf(body, lower)
    .filter((e) => plainText(body.slice(e.start, e.end)) === want);

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

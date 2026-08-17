// Where a `<section id="…">` starts and ends in a spec.
//
// Extracted from write-aside.mjs when delete-aside needed the same answer.
// Both write the spec file, and a splicer that cuts in the wrong place is the
// one bug in this area that loses a reader's work, so there is one of it.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';

/** A string safe to drop into a regex as a literal. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The index just past the tag closing the element opened at `from`.
 *
 * Depth-counted rather than matched with a non-greedy regex: a section holds
 * other sections' worth of markup, and `</section>` matched non-greedily would
 * cut at the first nested one.
 */
export function endOfElement(html, from, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Where `<section id="…">` opens and where it closes, with its attributes.
 *
 * @returns {null | {start:number, end:number, attrs:string, inner:number}}
 *   `inner` is the index just past the opening tag. Null when there is no such
 *   section, or when it is never closed: refusing beats truncating the file at
 *   whatever came next.
 */
export function sectionRange(html, id) {
  const re = /<section\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (getAttr(m[1], 'id') !== id) continue;
    const end = endOfElement(html, re.lastIndex, 'section');
    if (end === -1) return null;
    return { start: m.index, end, attrs: m[1], inner: re.lastIndex };
  }
  return null;
}

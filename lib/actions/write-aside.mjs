// Write an aside into a spec.
//
// This exists because the skill telling an agent what markup to produce is
// prose, and prose is not a mechanism. The first real Visualize run wrote its
// diagram straight into the section, with no `data-sf-aside` wrapper and so no
// way for the reader to reject it. An agent that runs this cannot get the
// attributes, the id or the placement wrong, because it does not write them.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';
import { actionById } from './all.mjs';

/**
 * The index just past the tag closing the element opened at `from`.
 *
 * Depth-counted rather than matched with a non-greedy regex: a section holds
 * other sections' worth of markup, and `</section>` matched non-greedily would
 * cut at the first nested one and insert the aside into the middle of the
 * document.
 */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endOfElement(html, from, tag) {
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

/** Where `<section id="…">` opens, and where it closes. */
function sectionRange(html, id) {
  const re = /<section\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (getAttr(m[1], 'id') !== id) continue;
    const end = endOfElement(html, re.lastIndex, 'section');
    if (end === -1) return null; // unclosed: refuse rather than truncate
    return { start: m.index, end };
  }
  return null;
}

/**
 * The next free `<sectionId>-aside-<n>`.
 *
 * The id is escaped before it goes into a regex. Section ids are author-written
 * and nothing stops one holding a dot, so `v1.2` unescaped would match
 * `v1x2-aside-1` and hand back a number already taken.
 */
function nextAsideId(html, section) {
  const re = new RegExp(`id="${escapeRe(section)}-aside-(\\d+)"`, 'g');
  let max = 0;
  let m;
  while ((m = re.exec(html))) max = Math.max(max, Number(m[1]));
  return `${section}-aside-${max + 1}`;
}

/**
 * Insert an aside section immediately after its source section.
 *
 * @param {string} html the spec
 * @param {{section:string, action:string, body:string}} opts
 * @returns {{html:string, id:string}}
 */
export function writeAside(html, { section, action, body, block } = {}) {
  const a = actionById(action);
  if (!a) throw new Error(`aside: unknown action ${JSON.stringify(action)}`);
  // Refused rather than allowed-and-ignored. An aside from Tighten would be a
  // draft nobody asked for, sitting beside prose that was supposed to be
  // rewritten in place.
  if (a.kind !== 'aside') {
    throw new Error(`aside: ${a.id} is a ${a.kind} action; it edits the section rather than writing an aside`);
  }
  const inner = typeof body === 'string' ? body.trim() : '';
  if (!inner) throw new Error('aside: a body is required');

  const at = sectionRange(html, section);
  if (!at) throw new Error(`aside: no section ${JSON.stringify(section)} in this spec`);

  const id = nextAsideId(html, section);
  // Placed after the source section, and after any aside already on it, so
  // several stack in the order they were run and all stay before the next
  // section. sectionRange finds the source; asides already there are sections
  // too, so walk past them.
  let insertAt = at.end;
  for (;;) {
    const rest = html.slice(insertAt);
    const next = rest.match(/^\s*<section\b([^>]*)>/);
    if (!next || getAttr(next[1], 'data-sf-aside') !== section) break;
    const after = endOfElement(html, insertAt + next[0].length, 'section');
    if (after === -1) break;
    insertAt = after;
  }

  // The bid of the block the action was asked for on, when the caller has one.
  // It is what puts the marker on that block rather than at the top of the
  // section, and it is optional: an unavailable registry means no bid, and the
  // marker falls back to the section rather than the aside becoming unreachable.
  const blockAttr = /^b\d+$/.test(String(block || '')) ? ` data-sf-block="${block}"` : '';
  const el = `\n  <section id="${id}" data-sf-aside="${section}"${blockAttr} data-sf-action="${a.id}">\n`
    + `    <h3>Aside: ${a.label}</h3>\n    ${inner}\n  </section>`;
  return { html: html.slice(0, insertAt) + el + html.slice(insertAt), id };
}

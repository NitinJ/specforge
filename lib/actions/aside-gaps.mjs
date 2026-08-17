// Aside actions in a batch that produced no aside.
//
// The backstop under the delivery fix. What made this feature fail four times
// running was not only that the agent did the wrong thing, it was that nothing
// noticed: it edited the section, replied as though it had drafted something,
// and closed the batch. Every layer agreed the work was done.
//
// So batch-done asks this first. A gap is a loud failure with the exact command
// attached, which is the same shape as the verification gate: fail, say what
// failed, say how to fix it, run again.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

import { actionsForThread } from './for-thread.mjs';
import { getAsideSectionIds } from '../spec.mjs';

/** True when the spec already carries an aside for this action on this section. */
function hasAside(html, section, action) {
  for (const id of getAsideSectionIds(html)) {
    const m = html.match(new RegExp(`<section\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
    if (!m) continue;
    const attrs = m[0];
    if (!attrs.includes(`data-sf-aside="${section}"`)) continue;
    if (attrs.includes(`data-sf-action="${action}"`)) return true;
  }
  return false;
}

/**
 * Every aside a batch asked for and did not get.
 *
 * A thread that resolves to no section is skipped rather than reported: there is
 * nowhere to place an aside, `actionsForThread` already told the agent to reply
 * saying so, and holding the batch open on it would be a dead end.
 *
 * @param {object[]} threads the batch's threads
 * @param {string} html the spec
 * @param {{specId:string, cli:string}} ctx
 * @returns {{thread:string, action:string, section:string, run:string}[]}
 */
export function asideGaps(threads, html, ctx) {
  const out = [];
  for (const t of threads || []) {
    for (const a of actionsForThread(t, ctx)) {
      if (a.kind !== 'aside' || !a.run) continue;
      if (hasAside(html, a.section, a.id)) continue;
      out.push({ thread: t.id, action: a.id, section: a.section, run: a.run });
    }
  }
  return out;
}

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

/**
 * True when the spec carries an aside answering THIS request.
 *
 * Keyed on the thread AND the action, because either alone leaves a hole.
 *
 * Section plus action is too coarse across threads: ask `@visualize` on §object
 * today and a draft written on §object last week closes the batch. Thread alone
 * is too coarse within one: a thread accumulates requests across batches, and a
 * single comment can name two actions, so the first draft written would answer
 * for all of them.
 *
 * What is left is the same action asked twice on the same thread in different
 * batches. The first draft satisfies the second ask, which is the behaviour to
 * want: there is already a draft answering that action on that thread, and
 * `--force` covers the case where a second is genuinely wanted.
 */
function answeredBy(html, threadId, actionId) {
  for (const id of getAsideSectionIds(html)) {
    const m = html.match(new RegExp(`<section\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
    if (!m) continue;
    const attrs = m[0];
    if (attrs.includes(`data-sf-thread="${threadId}"`)
      && attrs.includes(`data-sf-action="${actionId}"`)) return true;
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
      if (answeredBy(html, t.id, a.id)) continue;
      out.push({ thread: t.id, action: a.id, section: a.section, run: a.run });
    }
  }
  return out;
}

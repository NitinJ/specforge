// Turn a thread's actions into something the agent cannot miss.
//
// The feature failed four times out of four, and the cause was delivery rather
// than wording. `specforge comments` handed back `"@agent @visualize"` and
// nothing else, so the token arrived reading like ordinary English, with its
// instruction and its command living in a section of a skill file the agent had
// no reason to open. Meanwhile the text that woke the session said "amend the
// spec.html per the comments", which is exactly what the agent then did.
//
// So the expansion happens here, on the way out, and rides on the thread the
// agent is already reading: the instruction in full, the command with this
// thread's own section and block already in it, and a sentence saying what not
// to do. Nothing to look up and nothing to remember.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

import { parseActions } from './parse.mjs';
import { importTarget } from './import-target.mjs';

/**
 * The human comments of a thread that are asking for something now.
 *
 * A thread accumulates. Without `batchIds` a reply on Tuesday re-resolves the
 * `@visualize` asked for on Monday, so the wake-up text announces an action
 * already done and batch-done demands a draft for it a second time. Comments are
 * stamped with the batch that submitted them, which is what says "this one is
 * live".
 *
 * Kept as comments rather than joined into one body, so each action can be
 * attributed to the batch that asked for it: two batches can be pending at once,
 * and an action from the second must not be delivered as part of the first. It
 * also keeps a qualifier with its own request instead of mixing Monday's words
 * into Tuesday's action.
 *
 * Omitting `batchIds` reads the whole thread, which is right for a caller with
 * no batch in hand and is what the unit tests use.
 */
function liveComments(thread, batchIds) {
  const live = batchIds
    ? (c) => c.batchId && batchIds.has(c.batchId)
    : () => true;
  return ((thread && thread.comments) || []).filter((c) => c.kind === 'human' && live(c));
}

function anchorOf(thread) {
  const b = (thread && thread.anchor && thread.anchor.block) || {};
  return { section: (b.sectionPath || [])[0] || null, bid: b.bid || null };
}

/** The shell-ready `specforge aside` line for this action on this thread. */
function asideCommand(action, { specId, cli, section, bid, threadId, batchId }) {
  if (!section) return null; // nothing to place an aside after
  const parts = [
    `node "${cli}" aside ${specId}`,
    `--section ${section}`,
    ...(bid ? [`--block ${bid}`] : []),
    // Thread and batch together are what make this request distinguishable from
    // every other. Thread alone lets an older draft on the same thread close a
    // new ask: "@visualize" then "@visualize again, as a table" is two requests
    // with two answers, and only the batch tells them apart.
    ...(threadId ? [`--thread ${threadId}`] : []),
    ...(batchId ? [`--batch ${batchId}`] : []),
    `--action ${action.id}`,
    '--file <path-to-your-output.html>',
  ];
  return parts.join(' ');
}

/**
 * What to do with this action, in a sentence.
 *
 * Written to contradict the wake-up text head on. That text tells the agent to
 * amend the spec, it is the message the agent is certain to read, and an aside
 * action is the case where amending the spec is the defect.
 */
function nextFor(action, { section, run, detail }) {
  const ask = action.needsDetail && !detail
    ? ' The comment carries no detail, and this action cannot run without one: say what you would have '
      + 'done and ask, rather than guessing.'
    : '';
  if (action.kind === 'direct') return 'The browser answers this one. Nothing to do.';
  if (action.scope === 'global') {
    return `Scope is the whole spec, not the section this comment sits on. Read the whole document and `
      + `edit it, following the instruction.${ask}`;
  }
  if (action.scope === 'aside') {
    // @import arrives from the button on an aside, so the comment
    // is anchored inside one and `section` is that aside's id. What they act on
    // is resolved from the aside itself in actionsForThread.
    return `This answers the aside \`${section}\`. Act on that aside and on nothing else.${ask}`;
  }
  if (action.kind === 'aside') {
    if (!run) {
      return 'This writes an aside, and an aside is placed after a section. This thread resolves to no '
        + `section, so there is nowhere to put one: reply saying so rather than editing the spec.${ask}`;
    }
    return 'This writes an aside, not an edit. Do not edit the section. Write your output to a file and '
      + `run the command in \`run\`, which already carries this thread's section and block.${ask}`;
  }
  return `Edit ${section ? `the section \`${section}\`` : 'the commented block'} directly, following the `
    + `instruction.${ask}`;
}

/**
 * Every action a thread asks for, resolved.
 *
 * @param {object} thread a thread from the comment store
 * @param {{specId:string, cli:string}} ctx
 * @returns {object[]} one entry per action, in the order written
 */
export function actionsForThread(thread, { specId, cli, batchIds, html, bids } = {}) {
  const { section, bid } = anchorOf(thread);
  const threadId = thread && thread.id;
  const out = [];
  const seen = new Set();
  for (const c of liveComments(thread, batchIds)) {
    for (const a of parseActions(c.body)) {
      // Keyed by batch as well as by action: the same action asked in two
      // pending batches is two requests, and answering one does not answer the
      // other. Asked twice inside one batch is one.
      const key = `${a.id}::${c.batchId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const run = a.kind === 'aside'
        ? asideCommand(a, { specId, cli, section, bid, threadId, batchId: c.batchId })
        : null;
      // @import is the one action whose instruction cannot be written in
      // advance: what it merges, where, and whether it replaces the section all
      // come from the aside being answered. Resolved here so the agent is handed
      // the concrete version rather than the general one.
      const target = a.id === 'import' && html ? importTarget(html, section, { bids }) : null;
      out.push({
        id: a.id,
        label: a.label,
        kind: a.kind,
        scope: a.scope,
        instruction: a.instruction,
        ...(target ? { target } : {}),
        detail: a.detail,
        needsDetail: a.needsDetail,
        // Which submission asked for this. Two batches can be pending at once,
        // and an action belonging to the second must not be delivered as part
        // of the first and then demanded again when the second comes round.
        batchId: c.batchId || null,
        section,
        block: bid,
        run,
        next: target ? target.next : nextFor(a, { section, run, detail: a.detail }),
      });
    }
  }
  return out;
}

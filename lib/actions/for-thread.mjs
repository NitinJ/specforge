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

/** The human half of a thread, which is the only half that asks for anything. */
function humanBody(thread) {
  return ((thread && thread.comments) || [])
    .filter((c) => c.kind === 'human')
    .map((c) => c.body)
    .join('\n');
}

function anchorOf(thread) {
  const b = (thread && thread.anchor && thread.anchor.block) || {};
  return { section: (b.sectionPath || [])[0] || null, bid: b.bid || null };
}

/** The shell-ready `specforge aside` line for this action on this thread. */
function asideCommand(action, { specId, cli, section, bid }) {
  if (!section) return null; // nothing to place an aside after
  const parts = [
    `node "${cli}" aside ${specId}`,
    `--section ${section}`,
    ...(bid ? [`--block ${bid}`] : []),
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
export function actionsForThread(thread, { specId, cli } = {}) {
  const { section, bid } = anchorOf(thread);
  return parseActions(humanBody(thread)).map((a) => {
    const run = a.kind === 'aside' ? asideCommand(a, { specId, cli, section, bid }) : null;
    return {
      id: a.id,
      label: a.label,
      kind: a.kind,
      scope: a.scope,
      instruction: a.instruction,
      detail: a.detail,
      needsDetail: a.needsDetail,
      section,
      block: bid,
      run,
      next: nextFor(a, { section, run, detail: a.detail }),
    };
  });
}

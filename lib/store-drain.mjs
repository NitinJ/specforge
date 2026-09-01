// Drain routing for v2 (design §7). A batch submitted in the browser is picked
// up by the session that owns the spec: its review watcher notices while the
// session is idle, and its Stop/UserPromptSubmit hooks surface anything pending
// on the next turn, routing Claude to the review-spec skill.
//
// A batch on a spec whose session has gone waits for a human. There used to be a
// headless fallback that woke a fresh Claude for those, off by default and never
// switched on; the spec page now says Disconnected and offers Reconnect, which
// is the same job done in the open.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readMeta } from './meta.mjs';
import { specsForSession, watcherAlive } from './attach.mjs';
import { listPendingForSpec, advanceBatchProgress } from './store-inbox.mjs';
import { actionById } from './actions/all.mjs';
import { actionIdsIn } from './actions/parse.mjs';
import { loadComments } from './store-comments.mjs';
import { skillRef } from './skill-ref.mjs';

/**
 * Action ids asked for by the threads in one batch.
 *
 * Read here rather than left to the skill, so the wake-up text can name them
 * before the agent starts. Failure is not fatal: an unreadable comment store
 * means a batch with no actions listed, which is the text this had before.
 */
function batchActionIds(specId, batch) {
  try {
    const ids = new Set(batch.threadIds || []);
    const threads = (loadComments(specId).threads || []).filter((t) => ids.has(t.id));
    const out = [];
    for (const t of threads) {
      for (const c of t.comments || []) {
        // This batch's comments only. A thread accumulates, so reading all of
        // them would announce an action answered in an earlier round as though
        // it were being asked for again.
        if (c.kind !== 'human' || c.batchId !== batch.batchId) continue;
        for (const a of actionIdsIn(c.body)) if (!out.includes(a)) out.push(a);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The actions a batch names, as registry records.
 *
 * Ids the registry does not know are dropped rather than announced: a typo is
 * not an action, and naming it here would have the wake-up text assert something
 * about a thing that does not exist.
 */
function namedActions(batch) {
  return ((batch && batch.actions) || []).map((id) => actionById(id)).filter(Boolean);
}

/** The command an agent runs to arm or re-arm its watcher. */
export const WATCH_CMD = `node "${join(dirname(fileURLToPath(import.meta.url)), 'specforge-cli.mjs')}" wait-batch`;

/** Pending review batches across all specs a session owns (with spec titles). */
export function pendingForSession(sessionId) {
  const out = [];
  for (const id of specsForSession(sessionId)) {
    const meta = readMeta(id);
    for (const b of listPendingForSpec(id)) {
      // Surfacing a batch to its live owner = "picked up"; the review-spec skill
      // later advances it to "working". Monotonic, so re-surfacing never regresses.
      advanceBatchProgress(id, b.batchId, 'picked_up');
      out.push({ ...b, title: (meta && meta.title) || id, actions: batchActionIds(id, b) });
    }
  }
  return out;
}

/**
 * Instruction text routing Claude to review-spec for the pending batches.
 *
 * This is the message the agent is certain to read: it is the one that woke it.
 * That is why the watcher re-arm is repeated here rather than left to the skill,
 * and it is why this text used to be the feature's biggest defect. It said
 * "amend the spec.html per the comments" unconditionally, so four aside actions
 * in a row were answered by editing the spec, which is the one thing an aside
 * action must not do. An instruction in SKILL.md was never going to outrank the
 * instruction that started the turn.
 *
 * So a batch carrying actions says so here, by name, before the agent begins.
 */
export function reviewReason(batches, env = process.env) {
  const lines = batches.map(
    (b) => `  - batch ${b.batchId} on spec ${b.specId} ("${b.title}") — ${b.threadIds.length} thread(s)`
      + (namedActions(b).length ? `, actions: ${namedActions(b).map((a) => `@${a.id}`).join(' ')}` : '')
  );
  const all = batches.flatMap(namedActions);
  const asides = all.filter((a) => a.kind === 'aside');
  const actionNote = all.length ? [
    '',
    `These batches carry actions: ${[...new Set(all.map((a) => `@${a.id}`))].join(' ')}. An action is a`,
    'stored instruction, and `specforge comments <id>` now hands you each one resolved on its thread:',
    'the instruction to follow, what to do with the result, and the command to run where there is one.',
    'Read that rather than the name — the names read like ordinary English and they are not.',
  ] : [];
  const asideNote = asides.length ? [
    '',
    `${[...new Set(asides.map((a) => `@${a.id}`))].join(' ')} write an **aside**, not an edit.`,
    'Do not edit the section the comment sits on. The thread carries the exact `specforge aside`',
    'command to run, already filled in with its section and block.',
  ] : [];

  return [
    `SpecForge: ${batches.length} review batch(es) submitted in the browser await your reply:`,
    ...lines,
    '',
    `Run the ${skillRef('review-spec', env)} skill now: for each batch, read its threads`,
    '(specforge comments <id>), reply inline to each (specforge reply <id> <threadId> --body "…"),',
    all.length
      ? 'and amend the spec.html per the comments, unless an action says otherwise, then mark the batch done'
      : 'amend the spec.html per the comments, then mark the batch done',
    '(specforge batch-done <id> <batchId>). Do not resolve threads — humans do that.',
    ...actionNote,
    ...asideNote,
    '',
    // Said here as well as in the skill, because this text is what the agent is
    // certain to read: it is the instruction that woke it. An agent that answers
    // the batch without re-arming leaves the spec deaf to the next one.
    `Then re-arm the review watcher in the background: ${WATCH_CMD}`,
  ].join('\n');
}

/**
 * Is a watcher process running for this session?
 *
 * Asked of the process, not the heartbeat. A beat proves one happened recently,
 * which is the right approximation for the browser badge but wrong at the
 * boundary that matters here: `wait-batch` exits the moment it delivers a batch,
 * so for the next thirty seconds its last beat is still fresh while no watcher
 * exists at all — and that window is exactly when an agent finishes the review
 * and settles, which is exactly when it needed telling.
 */
export function watcherBeating(sessionId) {
  return watcherAlive(sessionId);
}

/**
 * Instruction text for a session that owns specs with nothing watching them.
 *
 * Nothing in code ever arms a watcher: an agent reads an instruction and runs a
 * background command, or forgets to. The watcher also exits every time it
 * delivers a batch, because exiting is how it reports — so the state recurs by
 * design rather than by accident. This checks the fact rather than trusting the
 * reminder was acted on, which is why it exists alongside the one in
 * reviewReason.
 */
export function armWatcherReason(specIds, env = process.env) {
  return [
    `SpecForge: ${specIds.length} spec(s) attached to this session have nobody watching them:`,
    ...specIds.map((id) => {
      const m = readMeta(id);
      return `  - ${id}${m && m.title ? ` ("${m.title}")` : ''}`;
    }),
    '',
    'Comments submitted in the browser will sit unread until a watcher is running,',
    'and the spec page reports them as Disconnected. Arm one in the background now:',
    `  ${WATCH_CMD}`,
    '',
    `On completion it returns { ready, pending } — on ready, run ${skillRef('review-spec', env)}`,
    'for each pending spec and relaunch it.',
  ].join('\n');
}


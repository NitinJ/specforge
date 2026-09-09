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
import { listPendingForSpec } from './store-inbox.mjs';
import { exportRequestsForSession, exportReason } from './store-export.mjs';
import { generateRequestsForSession, generateReason } from './store-generate.mjs';
import { actionById } from './actions/all.mjs';
import { actionIdsIn } from './actions/parse.mjs';
import { loadComments } from './store-comments.mjs';
import { skillRef } from './skill-ref.mjs';
import { CODEX_HARNESS, PI_HARNESS, resolveHarness } from './harness-context.mjs';

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
export const REVIEW_WAIT_CMD = `node "${join(dirname(fileURLToPath(import.meta.url)), 'specforge-cli.mjs')}" review-wait`;

/** Pending review batches across all specs a session owns (with spec titles). */
export function pendingForSession(sessionId) {
  const out = [];
  for (const id of specsForSession(sessionId)) {
    const meta = readMeta(id);
    for (const b of listPendingForSpec(id)) {
      out.push({ ...b, title: (meta && meta.title) || id, actions: batchActionIds(id, b) });
    }
  }
  return out;
}

/**
 * Read the highest-priority work waiting for one session without consuming it.
 * A skill acknowledges delivery with batch-working, export-working, or by
 * completing template generation. Until then the work remains recoverable when
 * a hook result or foreground tool result is lost.
 */
export function deliveryKey(kind, item) {
  return JSON.stringify([kind, item.specId, item.requestId ?? item.requestedAt]);
}

export function pendingWorkForSession(sessionId, env = process.env, delivered = new Set()) {
  const reviews = pendingForSession(sessionId).filter((b) =>
    !delivered.has(deliveryKey('review', { specId: b.specId, requestId: b.batchId })));
  if (reviews.length) {
    return {
      kind: 'review',
      items: reviews.map((b) => ({ specId: b.specId, requestId: b.batchId, batchId: b.batchId })),
      reason: reviewReason(reviews, env),
    };
  }
  const generates = generateRequestsForSession(sessionId).filter((m) =>
    !delivered.has(deliveryKey('generate', { specId: m.id, requestedAt: m.generate.requestedAt })));
  if (generates.length) {
    return {
      kind: 'generate',
      items: generates.map((m) => ({ specId: m.id, requestedAt: m.generate.requestedAt })),
      reason: generateReason(generates, env),
    };
  }
  const exports = exportRequestsForSession(sessionId).filter((m) =>
    !delivered.has(deliveryKey('export', { specId: m.id, requestedAt: m.export.requestedAt })));
  if (exports.length) {
    return {
      kind: 'export',
      items: exports.map((m) => ({ specId: m.id, requestedAt: m.export.requestedAt })),
      reason: exportReason(exports, env),
    };
  }
  return null;
}

/** Harness-specific continuation after a delivered review batch. */
function deliveryContinuation(env) {
  const harness = resolveHarness(env);
  if (harness === CODEX_HARNESS) {
    return [
      'After processing this work, finish the turn. The host-owned background watcher delivers later browser work automatically.',
      'Do not start a watcher or poll while idle.',
    ];
  }
  if (harness === PI_HARNESS) {
    return ['The Pi extension will re-arm delivery when this review turn settles.'];
  }
  return [`Then re-arm review delivery in the background: ${REVIEW_WAIT_CMD}`];
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
    ...deliveryContinuation(env),
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
  const harness = resolveHarness(env);
  if (harness === CODEX_HARNESS) return deliveryContinuation(env).join('\n');
  const pi = harness === PI_HARNESS;
  return [
    `SpecForge: ${specIds.length} spec(s) attached to this session have nobody watching them:`,
    ...specIds.map((id) => {
      const m = readMeta(id);
      return `  - ${id}${m && m.title ? ` ("${m.title}")` : ''}`;
    }),
    '',
    'Comments submitted in the browser will sit unread until delivery is running,',
    'and the spec page reports them as Disconnected.',
    pi
      ? 'The Pi extension owns delivery and will retry when this turn settles.'
      : 'Arm delivery in the background now:',
    ...(pi ? [] : [`  ${REVIEW_WAIT_CMD}`]),
    '',
    ...(pi ? [] : [
      'On completion it returns { ready, kind, work, reason }. Follow reason, then relaunch it.',
    ]),
  ].join('\n');
}

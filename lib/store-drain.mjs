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
import { specsForSession, isConnected } from './attach.mjs';
import { listPendingForSpec, advanceBatchProgress } from './store-inbox.mjs';

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
      out.push({ ...b, title: (meta && meta.title) || id });
    }
  }
  return out;
}

/** Instruction text routing Claude to review-spec for the pending batches. */
export function reviewReason(batches) {
  const lines = batches.map(
    (b) => `  - batch ${b.batchId} on spec ${b.specId} ("${b.title}") — ${b.threadIds.length} thread(s)`
  );
  return [
    `SpecForge: ${batches.length} review batch(es) submitted in the browser await your reply:`,
    ...lines,
    '',
    'Run the specforge:review-spec skill now: for each batch, read its threads',
    '(specforge comments <id>), reply inline to each (specforge reply <id> <threadId> --body "…"),',
    'amend the spec.html per the comments, then mark the batch done',
    '(specforge batch-done <id> <batchId>). Do not resolve threads — humans do that.',
    '',
    // Said here as well as in the skill, because this text is what the agent is
    // certain to read: it is the instruction that woke it. An agent that answers
    // the batch without re-arming leaves the spec deaf to the next one.
    `Then re-arm the review watcher in the background: ${WATCH_CMD}`,
  ].join('\n');
}

/**
 * Is anything listening for this session's specs?
 *
 * Every spec a session owns shares one heartbeat — the watcher stamps them all
 * on each poll — so one connected spec means a watcher is running, and none
 * means there isn't one.
 */
export function watcherBeating(sessionId) {
  return specsForSession(sessionId).some((id) => isConnected(readMeta(id)));
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
export function armWatcherReason(specIds) {
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
    'On completion it returns { ready, pending } — on ready, run specforge:review-spec',
    'for each pending spec and relaunch it.',
  ].join('\n');
}


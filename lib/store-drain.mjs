// Drain routing for v2 (design §7). A batch submitted in the browser is picked
// up by the session that owns the spec: its review watcher notices while the
// session is idle, and its Stop/UserPromptSubmit hooks surface anything pending
// on the next turn, routing Claude to the review-spec skill.
//
// A batch on a spec whose session has gone waits for a human. There used to be a
// headless fallback that woke a fresh Claude for those, off by default and never
// switched on; the spec page now says Disconnected and offers Reconnect, which
// is the same job done in the open.

import { readMeta } from './meta.mjs';
import { specsForSession } from './attach.mjs';
import { listPendingForSpec, advanceBatchProgress } from './store-inbox.mjs';

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
  ].join('\n');
}


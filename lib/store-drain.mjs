// Drain routing for v2 (design §7). A batch submitted in the browser is picked
// up by the session that owns the spec — its Stop/UserPromptSubmit hooks surface
// the pending batches and route Claude to the review-spec skill. Orphaned/stale
// specs (no live owner) fall back to the daemon's headless drain (store-watch).

import { readMeta } from './meta.mjs';
import { specsForSession } from './attach.mjs';
import { listPendingForSpec } from './store-inbox.mjs';

/** Pending review batches across all specs a session owns (with spec titles). */
export function pendingForSession(sessionId) {
  const out = [];
  for (const id of specsForSession(sessionId)) {
    const meta = readMeta(id);
    for (const b of listPendingForSpec(id)) out.push({ ...b, title: (meta && meta.title) || id });
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

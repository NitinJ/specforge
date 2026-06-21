// Drain routing for v2 (design §7). A batch submitted in the browser is picked
// up by the session that owns the spec — its Stop/UserPromptSubmit hooks surface
// the pending batches and route Claude to the review-spec skill. Orphaned/stale
// specs (no live owner) fall back to the daemon's headless drain (store-watch).

import { readMeta, writeMeta } from './meta.mjs';
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

/**
 * Specs this session owns that the human just approved for implementation (the
 * one-shot signal set when status flipped to `implementing`). Surfaced once by
 * the hooks, then cleared.
 */
export function implementSignalsForSession(sessionId) {
  return specsForSession(sessionId)
    .map((id) => readMeta(id))
    .filter((m) => m && m.implementSignal && m.status === 'implementing');
}

/** Clear the one-shot implement signal (after a hook surfaces it). */
export function clearImplementSignal(id) {
  const m = readMeta(id);
  if (m && m.implementSignal) {
    delete m.implementSignal;
    writeMeta(id, m);
  }
}

/** Instruction text nudging Claude to start implementing the approved specs. */
export function implementReason(metas) {
  const lines = metas.map((m) => `  - spec ${m.id} ("${m.title}")`);
  return [
    `SpecForge: ${metas.length} spec(s) approved for implementation:`,
    ...lines,
    '',
    'Begin implementing now — keep the spec the source of truth: work stage by stage',
    '(one PR per stage, TDD), keep the task tracker / decisions current. When the spec',
    'is fully implemented (or needs no code), run: specforge status <id> done.',
  ].join('\n');
}

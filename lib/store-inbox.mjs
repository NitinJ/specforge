// Review inbox for the v2 global store. Submitting a batch freezes a spec's
// un-submitted human comments and drops a pending batch file at
// ~/.specforge/specs/<id>/inbox/<batchId>.json, which the owning session's review
// watcher and hooks read. Store-id-keyed analogue of v1's specsDir-keyed inbox.mjs.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inboxDir } from './store-paths.mjs';
import { mutateComments } from './store-comments.mjs';
import { isAgent, isForAgent } from './comments.mjs';

/**
 * Where a batch was submitted from.
 *
 * `daemon` is the owner's loopback page; `share` is a reviewer, through a
 * published spec or a shared project. The agent answers both, but only edits
 * the document for the owner (spec 82f5dabccf, D3), so this is the field that
 * carries authority — recorded at submit and immutable after, like everything
 * else a batch freezes.
 */
export const BATCH_ORIGINS = new Set(['daemon', 'share']);

/** The owner's, which is what every batch was before reviewers could submit. */
export const DEFAULT_BATCH_ORIGIN = 'daemon';

/**
 * Freeze the human comments of every unresolved, agent-directed thread into a
 * batch. A thread is agent-directed when a human in it wrote @agent.
 *
 * Whole threads go, not only the comment carrying the mention: when a thread
 * has been running between people and someone then hands it over, the earlier
 * exchange is the reasoning behind the request.
 *
 * @param {{origin?: 'daemon'|'share'}} [opts] which path submitted this; the
 *   owner's by default, because that is what an unmarked batch has always been.
 * @returns {null | {batchId, specId, threadIds, createdAt, status, origin}}
 */
export function submitBatch(id, now = new Date().toISOString(), opts = {}) {
  const origin = opts.origin === undefined ? DEFAULT_BATCH_ORIGIN : opts.origin;
  if (!BATCH_ORIGINS.has(origin)) {
    throw new Error(`submitBatch: origin must be one of ${[...BATCH_ORIGINS].join(', ')}`);
  }
  const batchId = 'b_' + randomBytes(4).toString('hex');
  // Lock + stamp the un-submitted human comments with this batchId, atomically.
  const threadIds = mutateComments(id, (store) => {
    const ids = [];
    for (const t of store.threads) {
      if (t.state === 'resolved') continue;
      if (!isForAgent(t)) continue; // discussion between people; never wakes an agent
      let touched = false;
      for (const c of t.comments) {
        if (!isAgent(c) && !c.batchId) {
          c.batchId = batchId;
          touched = true;
        }
      }
      if (touched) ids.push(t.id);
    }
    return ids;
  });
  if (!threadIds.length) return null;

  const dir = inboxDir(id);
  mkdirSync(dir, { recursive: true });
  const batch = { batchId, specId: id, threadIds, createdAt: now, status: 'pending', origin };
  writeFileSync(join(dir, `${batchId}.json`), JSON.stringify(batch, null, 2));
  return batch;
}

export function readBatch(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Pending batches for a single spec (with their file paths). */
export function listPendingForSpec(id) {
  const dir = inboxDir(id);
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const file = join(dir, f);
    const batch = readBatch(file);
    // A batch with no origin predates the field. Read as the owner's: that is
    // what every batch was, and reading it as a reviewer's would silently stop
    // the agent amending on a batch submitted before the upgrade.
    if (batch && batch.status === 'pending') {
      out.push({ origin: DEFAULT_BATCH_ORIGIN, ...batch, file });
    }
  }
  return out;
}


// Review-progress for a pending batch, surfaced to the browser action button:
//   (unset) → picked_up → working → (done, file removed)
// picked_up is set when a hook surfaces the batch to its owning session; working
// when the review-spec skill starts amending the spec.
const PROGRESS_RANK = { picked_up: 1, working: 2 };

/**
 * Advance a pending batch's progress. Monotonic — never regresses (a Stop hook
 * re-surfacing a batch the skill already marked `working` won't drop it back to
 * `picked_up`). Returns true iff the progress actually moved forward.
 */
export function advanceBatchProgress(id, batchId, progress) {
  const file = join(inboxDir(id), `${batchId}.json`);
  const batch = readBatch(file);
  if (!batch) return false;
  const cur = PROGRESS_RANK[batch.progress] || 0;
  if (!PROGRESS_RANK[progress] || PROGRESS_RANK[progress] <= cur) return false;
  batch.progress = progress;
  writeFileSync(file, JSON.stringify(batch, null, 2));
  return true;
}

/** Highest review-progress across a spec's pending batches, or null if none. */
export function reviewProgressForSpec(id) {
  let best = null;
  let bestRank = 0;
  for (const b of listPendingForSpec(id)) {
    const r = PROGRESS_RANK[b.progress] || 0;
    if (r > bestRank) { bestRank = r; best = b.progress; }
  }
  return best;
}

/**
 * Is an agent part-way through a round of review on this spec?
 *
 * True from the moment a batch is submitted until the agent marks it done. That
 * span is one round of work — several threads answered and the document amended
 * a section at a time — and the reader wants to see the end of it, not each
 * intermediate save. The live-reload transports gate on this so a spec being
 * worked on reloads once, when the round finishes, instead of on every write.
 */
export function agentBusy(id) {
  return listPendingForSpec(id).length > 0;
}

/** Clear a processed batch so the drain layer stops surfacing it. */
export function markBatchDone(id, batchId) {
  try {
    rmSync(join(inboxDir(id), `${batchId}.json`));
    return true;
  } catch {
    return false;
  }
}

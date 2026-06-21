// Review inbox for the v2 global store. Submitting a batch freezes a spec's
// un-submitted human comments and drops a pending batch file the drain layer
// watches, at ~/.specforge/specs/<id>/inbox/<batchId>.json. Store-id-keyed
// analogue of v1's specsDir-keyed inbox.mjs.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inboxDir, specsDir } from './store-paths.mjs';
import { mutateComments } from './store-comments.mjs';

/**
 * Freeze all un-submitted, unresolved human comments for a spec into a batch.
 * @returns {null | {batchId, specId, threadIds, createdAt, status}}
 */
export function submitBatch(id, now = new Date().toISOString()) {
  const batchId = 'b_' + randomBytes(4).toString('hex');
  // Lock + stamp the un-submitted human comments with this batchId, atomically.
  const threadIds = mutateComments(id, (store) => {
    const ids = [];
    for (const t of store.threads) {
      if (t.state === 'resolved') continue;
      let touched = false;
      for (const c of t.comments) {
        if (c.author === 'human' && !c.batchId) {
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
  const batch = { batchId, specId: id, threadIds, createdAt: now, status: 'pending' };
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
    if (batch && batch.status === 'pending') out.push({ ...batch, file });
  }
  return out;
}

/** Pending batches across every spec in the store (for the daemon orphan-drain). */
export function listAllPending() {
  let ids;
  try {
    ids = readdirSync(specsDir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return ids.flatMap((id) => listPendingForSpec(id));
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

/** Clear a processed batch so the drain layer stops surfacing it. */
export function markBatchDone(id, batchId) {
  try {
    rmSync(join(inboxDir(id), `${batchId}.json`));
    return true;
  } catch {
    return false;
  }
}

// Review inbox: submitting a batch of comments freezes them and drops a pending
// batch file the Stop hook watches. Lives at
// <specsDir>/.specforge/<specId>/inbox/<batchId>.json.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadStore, saveStore } from './comments.mjs';

function specforgeRoot(specsDir) {
  return join(specsDir, '.specforge');
}
export function inboxDir(specsDir, specId) {
  return join(specforgeRoot(specsDir), specId, 'inbox');
}

/**
 * Freeze all un-submitted, unresolved human comments into a new batch.
 * @returns {null | {batchId, specId, specPath, threadIds, createdAt, status}}
 */
export function submitBatch(specsDir, specId, specPath = '', now = new Date().toISOString()) {
  const store = loadStore(specsDir, specId, specPath);
  const batchId = 'b_' + randomBytes(4).toString('hex');
  const threadIds = [];
  for (const t of store.threads) {
    if (t.state === 'resolved') continue;
    let touched = false;
    for (const c of t.comments) {
      if (c.author === 'human' && !c.batchId) {
        c.batchId = batchId;
        touched = true;
      }
    }
    if (touched) threadIds.push(t.id);
  }
  if (!threadIds.length) return null;
  saveStore(specsDir, store);

  const dir = inboxDir(specsDir, specId);
  mkdirSync(dir, { recursive: true });
  const batch = { batchId, specId, specPath, threadIds, createdAt: now, status: 'pending' };
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

/** All pending batch files under a specs dir, across every spec. */
export function listPendingBatches(specsDir) {
  const root = specforgeRoot(specsDir);
  const out = [];
  let specDirs;
  try {
    specDirs = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of specDirs) {
    if (!d.isDirectory()) continue;
    let files;
    try {
      files = readdirSync(join(root, d.name, 'inbox'));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const file = join(root, d.name, 'inbox', f);
      const batch = readBatch(file);
      if (batch && batch.status === 'pending') out.push({ ...batch, file });
    }
  }
  return out;
}

/** Clear a processed batch so the Stop hook stops nudging. */
export function markBatchDone(specsDir, specId, batchId) {
  try {
    rmSync(join(inboxDir(specsDir, specId), `${batchId}.json`));
    return true;
  } catch {
    return false;
  }
}

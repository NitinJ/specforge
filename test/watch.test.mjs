import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWatcher, tokenizeArgs } from '../lib/watch.mjs';
import { submitBatch, markBatchDone, listPendingBatches } from '../lib/inbox.mjs';
import { loadStore, saveStore, createThread } from '../lib/comments.mjs';

const anchor = { block: { index: 1, tag: 'P', text: 'x' } };

function seededWithBatch() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-watch-'));
  const store = loadStore(dir, 'spec1', 'x.html');
  createThread(store, { anchor, body: 'c1' });
  saveStore(dir, store);
  submitBatch(dir, 'spec1', 'x.html');
  return dir;
}

test('tick drains pending batches, then no-ops once the inbox is cleared', async () => {
  const dir = seededWithBatch();
  const seen = [];
  const drain = (sd, pending) => {
    seen.push(pending.map((b) => b.batchId));
    // simulate review-spec clearing the inbox
    for (const b of pending) markBatchDone(sd, b.specId, b.batchId);
    return Promise.resolve();
  };
  const w = createWatcher({ specsDir: dir, drain });

  await w.tick();
  assert.equal(seen.length, 1);
  assert.equal(listPendingBatches(dir).length, 0);

  await w.tick(); // nothing pending now
  assert.equal(seen.length, 1);
});

test('no pending → drain is never called', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-watch-empty-'));
  let calls = 0;
  const w = createWatcher({ specsDir: dir, drain: () => { calls++; return Promise.resolve(); } });
  await w.tick();
  assert.equal(calls, 0);
});

test('single-flight: overlapping ticks do not start a second drain', async () => {
  const dir = seededWithBatch();
  let calls = 0;
  let release;
  const drain = () => { calls++; return new Promise((r) => { release = r; }); };
  const w = createWatcher({ specsDir: dir, drain });

  const p1 = w.tick(); // starts the (slow) drain
  const p2 = w.tick(); // running → must not start another
  assert.equal(calls, 1);
  assert.equal(w.isRunning, true);

  release();
  await Promise.all([p1, p2]);
  assert.equal(w.isRunning, false);
});

test('stop() prevents further drains', async () => {
  const dir = seededWithBatch();
  let calls = 0;
  const w = createWatcher({ specsDir: dir, drain: () => { calls++; return Promise.resolve(); } });
  w.stop();
  await w.tick();
  assert.equal(calls, 0);
});

test('stop() reaps an in-flight drain child', async () => {
  const dir = seededWithBatch();
  let killed = false;
  let release;
  const drain = (sd, pending, register) => {
    register({ kill: () => { killed = true; } });
    return new Promise((r) => { release = r; });
  };
  const w = createWatcher({ specsDir: dir, drain });
  const p = w.tick();
  assert.equal(w.isRunning, true);
  w.stop();
  assert.equal(killed, true, 'in-flight child was killed on stop');
  release();
  await p;
});

test('tokenizeArgs keeps quoted values with spaces intact', () => {
  assert.deepEqual(tokenizeArgs('--permission-mode acceptEdits'), ['--permission-mode', 'acceptEdits']);
  assert.deepEqual(tokenizeArgs("--allowedTools 'Bash(git *)'"), ['--allowedTools', 'Bash(git *)']);
  assert.deepEqual(tokenizeArgs(''), []);
  assert.deepEqual(tokenizeArgs(undefined), []);
});

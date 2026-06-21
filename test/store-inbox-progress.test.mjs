// Unit tests for batch review-progress (lib/store-inbox.mjs): monotonic advance
// (picked_up → working, never backwards) and the per-spec rollup the action
// button reads.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { createThread } from '../lib/store-comments.mjs';
import { mutateComments } from '../lib/store-comments.mjs';
import {
  submitBatch, advanceBatchProgress, reviewProgressForSpec, markBatchDone,
} from '../lib/store-inbox.mjs';

let home;
let prevHome;
let id;

const anchor = { block: { index: 0, tag: 'P', text: 'the problem' } };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-inbox-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  mutateComments(id, (store) => createThread(store, { anchor, body: 'q', author: 'human' }));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('a fresh batch has no progress', () => {
  submitBatch(id);
  assert.equal(reviewProgressForSpec(id), null);
});

test('advance moves unset → picked_up → working', () => {
  const { batchId } = submitBatch(id);
  assert.equal(advanceBatchProgress(id, batchId, 'picked_up'), true);
  assert.equal(reviewProgressForSpec(id), 'picked_up');
  assert.equal(advanceBatchProgress(id, batchId, 'working'), true);
  assert.equal(reviewProgressForSpec(id), 'working');
});

test('advance never regresses (working stays working)', () => {
  const { batchId } = submitBatch(id);
  advanceBatchProgress(id, batchId, 'working');
  assert.equal(advanceBatchProgress(id, batchId, 'picked_up'), false, 'no downgrade');
  assert.equal(reviewProgressForSpec(id), 'working');
});

test('an unknown progress value is rejected', () => {
  const { batchId } = submitBatch(id);
  assert.equal(advanceBatchProgress(id, batchId, 'bogus'), false);
  assert.equal(reviewProgressForSpec(id), null);
});

test('progress clears when the batch is marked done', () => {
  const { batchId } = submitBatch(id);
  advanceBatchProgress(id, batchId, 'working');
  markBatchDone(id, batchId);
  assert.equal(reviewProgressForSpec(id), null);
});

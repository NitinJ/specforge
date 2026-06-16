import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { submitBatch, listPendingBatches, markBatchDone, inboxDir } from '../lib/inbox.mjs';
import { loadStore, saveStore, createThread } from '../lib/comments.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'comment-cli.mjs');
const anchor = { block: { index: 1, tag: 'P', text: 'x' } };

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-inbox-'));
  const store = loadStore(dir, 'spec1', 'x.html');
  const t = createThread(store, { anchor, body: 'c1' });
  saveStore(dir, store);
  return { dir, threadId: t.id };
}

test('submitBatch freezes comments, writes an inbox file, lists, and clears', () => {
  const { dir } = seeded();
  const batch = submitBatch(dir, 'spec1', 'x.html');
  assert.match(batch.batchId, /^b_/);
  assert.equal(batch.threadIds.length, 1);
  assert.ok(existsSync(join(inboxDir(dir, 'spec1'), `${batch.batchId}.json`)));

  // the comment now carries the batchId
  assert.ok(loadStore(dir, 'spec1').threads[0].comments[0].batchId);

  const pending = listPendingBatches(dir);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].batchId, batch.batchId);

  // nothing new to submit
  assert.equal(submitBatch(dir, 'spec1', 'x.html'), null);

  markBatchDone(dir, 'spec1', batch.batchId);
  assert.equal(listPendingBatches(dir).length, 0);
});

test('comment-cli reply appends a claude comment', () => {
  const { dir, threadId } = seeded();
  const res = spawnSync(process.execPath, [CLI, 'reply', dir, 'spec1', threadId, 'fixed in §3'], { encoding: 'utf8', timeout: 8000 });
  assert.ifError(res.error);
  assert.equal(res.status, 0, res.stderr);
  const store = loadStore(dir, 'spec1');
  assert.equal(store.threads[0].comments.length, 2);
  assert.equal(store.threads[0].comments[1].author, 'claude');
  assert.equal(store.threads[0].state, 'replied');
});

test('comment-cli reply --body-file + --edited', () => {
  const { dir, threadId } = seeded();
  const bf = join(dir, 'reply.txt');
  writeFileSync(bf, 'multi\nline reply');
  const res = spawnSync(process.execPath, [CLI, 'reply', dir, 'spec1', threadId, '--body-file', bf, '--edited'], { encoding: 'utf8', timeout: 8000 });
  assert.equal(res.status, 0, res.stderr);
  const c = loadStore(dir, 'spec1').threads[0].comments[1];
  assert.equal(c.body, 'multi\nline reply');
  assert.equal(c.editedSpec, true);
});

test('comment-cli done clears the inbox', () => {
  const { dir } = seeded();
  const batch = submitBatch(dir, 'spec1', 'x.html');
  const res = spawnSync(process.execPath, [CLI, 'done', dir, 'spec1', batch.batchId], { encoding: 'utf8', timeout: 8000 });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(listPendingBatches(dir).length, 0);
});

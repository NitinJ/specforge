import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import {
  attach, claimWorker, releaseWorker, watcherAlive, workerFor,
} from '../lib/attach.mjs';
import { createThread, loadComments, mutateComments } from '../lib/store-comments.mjs';
import { submitBatch, reviewProgressForSpec } from '../lib/store-inbox.mjs';
import { requestExport, exportRequestsForSession } from '../lib/store-export.mjs';
import { requestGenerate, generateRequestsForSession } from '../lib/store-generate.mjs';
import { pendingWorkForSession } from '../lib/store-drain.mjs';
import {
  cmdBatchDone, cmdBatchWorking, cmdExportWorking, cmdReply, cmdReviewWait,
  cmdTemplateWorking,
} from '../lib/specforge-cli.mjs';

let home;
let previousHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-codex-delivery-'));
  previousHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function owned(session, title = 'A') {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  attach(id, session);
  return id;
}

function addBatch(id, body = '@agent review this') {
  let thread;
  mutateComments(id, (store) => {
    thread = createThread(store, {
      anchor: { block: { index: 0, tag: 'P', text: body } },
      body,
      author: 'human',
    });
  });
  return { batch: submitBatch(id), thread };
}

const codexDeps = (session) => ({
  session,
  harness: 'codex',
  env: { SPECFORGE_HARNESS: 'codex', CODEX_THREAD_ID: session },
  sleep: async () => {},
});

test('inspection is read-only until each skill acknowledges pickup', async () => {
  const review = owned('thread-1', 'Review');
  const { batch } = addBatch(review);
  const generated = owned('thread-1', 'Template');
  requestGenerate(generated, 'A release checklist', '2026-09-08T00:00:00.000Z');
  const exported = owned('thread-1', 'Export');
  requestExport(exported, '2026-09-08T00:00:01.000Z');

  const first = pendingWorkForSession('thread-1', { SPECFORGE_HARNESS: 'codex' });
  assert.equal(first.kind, 'review');
  assert.equal(reviewProgressForSpec(review), null);
  assert.equal(readMeta(generated).generate.state, 'requested');
  assert.equal(readMeta(exported).export.state, 'requested');

  await cmdBatchWorking({ id: review, batchId: batch.batchId });
  await cmdBatchDone({ id: review, batchId: batch.batchId });
  assert.equal(pendingWorkForSession('thread-1').kind, 'generate');
  assert.equal(generateRequestsForSession('thread-1').length, 1);
  assert.equal((await cmdTemplateWorking({ id: generated })).ok, true);

  assert.equal(pendingWorkForSession('thread-1').kind, 'export');
  assert.equal(exportRequestsForSession('thread-1').length, 1);
  assert.equal((await cmdExportWorking({ id: exported })).ok, true);
  assert.equal(pendingWorkForSession('thread-1'), null);
});

test('review-wait delivers all browser work types with truthful foreground guidance', async () => {
  const id = owned('thread-export');
  requestExport(id, '2026-09-08T00:00:00.000Z');
  const result = await cmdReviewWait({ timeout: 0 }, codexDeps('thread-export'));
  assert.equal(result.ready, true);
  assert.equal(result.kind, 'export');
  assert.deepEqual(result.work, [{ specId: id, requestedAt: '2026-09-08T00:00:00.000Z' }]);
  assert.match(result.reason, /export-working/);
  assert.equal(readMeta(id).export.state, 'requested', 'returning work does not claim the skill saw it');
  assert.equal(watcherAlive('thread-export'), false, 'a completed tool is not reported as connected');
  assert.equal(workerFor('thread-export'), null);
});

test('two review submissions are delivered in sequence and duplicate replies are idempotent', async () => {
  const id = owned('thread-review');
  const first = addBatch(id, '@agent first');
  const deliveredFirst = await cmdReviewWait({ timeout: 0 }, codexDeps('thread-review'));
  assert.equal(deliveredFirst.work[0].requestId, first.batch.batchId);
  await cmdBatchWorking({ id, batchId: first.batch.batchId });
  const effect = `${first.batch.batchId}:${first.thread.id}:reply`;
  const one = await cmdReply({ id, tid: first.thread.id, body: 'Done', effect }, { harness: 'codex' });
  const retry = await cmdReply({ id, tid: first.thread.id, body: 'Done again', effect }, { harness: 'codex' });
  assert.equal(one.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(loadComments(id).threads[0].comments.filter((c) => c.kind === 'agent').length, 1);
  await cmdBatchDone({ id, batchId: first.batch.batchId });

  const second = addBatch(id, '@agent second');
  const deliveredSecond = await cmdReviewWait({ timeout: 0 }, codexDeps('thread-review'));
  assert.equal(deliveredSecond.work[0].requestId, second.batch.batchId);
  assert.notEqual(second.batch.batchId, first.batch.batchId);
});

test('worker leases isolate sessions and stale cleanup cannot clear a replacement', () => {
  owned('thread-a');
  owned('thread-b');
  const a1 = claimWorker('thread-a', { pid: 101, leaseId: 'lease-a1', alive: () => false });
  const b1 = claimWorker('thread-b', { pid: 202, leaseId: 'lease-b1', alive: () => false });
  assert.equal(a1.mode, 'background');
  assert.equal(workerFor('thread-b').leaseId, b1.leaseId);
  assert.throws(
    () => claimWorker('thread-a', { pid: 303, leaseId: 'blocked', alive: (pid) => pid === 101 }),
    /already active/,
  );
  const a2 = claimWorker('thread-a', { pid: 303, leaseId: 'lease-a2', alive: () => false });
  assert.equal(releaseWorker('thread-a', a1.leaseId), false);
  assert.equal(workerFor('thread-a').leaseId, a2.leaseId);
  assert.equal(releaseWorker('thread-a', a2.leaseId), true);
  assert.equal(workerFor('thread-a'), null);
  assert.equal(workerFor('thread-b').leaseId, b1.leaseId, 'another Codex thread is untouched');
});

test('timed-out foreground delivery clears its worker and connected state', async () => {
  owned('thread-idle');
  const result = await cmdReviewWait({ timeout: 0 }, codexDeps('thread-idle'));
  assert.deepEqual(result, { ready: false, pending: [], reason: 'timeout' });
  assert.equal(workerFor('thread-idle'), null);
  assert.equal(watcherAlive('thread-idle'), false);
});

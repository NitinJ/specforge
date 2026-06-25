import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { attach, STALE_MS } from '../lib/attach.mjs';
import { loadComments, saveComments, createThread } from '../lib/store-comments.mjs';
import { submitBatch, reviewProgressForSpec } from '../lib/store-inbox.mjs';
import { appendEvent } from '../lib/store-ledger.mjs';
import { pendingForSession, reviewReason } from '../lib/store-drain.mjs';
import { requestExport, exportRequestsForSession } from '../lib/store-export.mjs';
import { orphanedBatches, createDaemonDrain } from '../lib/store-watch.mjs';
import {
  cmdComments, cmdReply, cmdBatchDone, cmdBatchWorking, cmdWaitBatch,
  cmdExportWorking, cmdExportDone,
} from '../lib/specforge-cli.mjs';
import { run as stopRun } from '../hooks/stop.mjs';
import { run as upsRun } from '../hooks/user-prompt-submit.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-drain-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** A spec owned by `session` with one submitted review batch. */
function specWithBatch(session = 'sess-1') {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  attach(id, session);
  const store = loadComments(id);
  createThread(store, { anchor: { block: { index: 1, tag: 'P', text: 'the problem' } }, body: 'why?' });
  saveComments(id, store);
  const batch = submitBatch(id);
  return { id, batch };
}

test('pendingForSession returns the session’s submitted batches with titles', () => {
  const { id, batch } = specWithBatch('sess-1');
  const pending = pendingForSession('sess-1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].batchId, batch.batchId);
  assert.equal(pending[0].specId, id);
  assert.equal(pending[0].title, 'A');
  assert.deepEqual(pendingForSession('other'), []);
});

test('surfacing a batch to its owner marks it picked_up; the skill verb advances it to working', async () => {
  const { id, batch } = specWithBatch('sess-1');
  assert.equal(reviewProgressForSpec(id), null, 'fresh batch has no progress');

  pendingForSession('sess-1'); // a hook surfacing the batch
  assert.equal(reviewProgressForSpec(id), 'picked_up');

  const w = await cmdBatchWorking({ id, batchId: batch.batchId });
  assert.equal(w.ok, true);
  assert.equal(reviewProgressForSpec(id), 'working');

  pendingForSession('sess-1'); // a later hook must not regress working → picked_up
  assert.equal(reviewProgressForSpec(id), 'working');
});

test('wait-batch bumps the owned specs heartbeat each poll (keeps the session live)', async () => {
  const { id } = specWithBatch('sess-1');
  // Reply + mark done so there's no pending batch → wait-batch loops instead of returning early.
  const c = await cmdComments({ id });
  await cmdReply({ id, tid: c.threads[0].id, body: 'x' });
  await cmdBatchDone({ id, batchId: c.pending[0].batchId });
  const m = readMeta(id); m.heartbeat = 1000; writeMeta(id, m); // backdate
  const r = await cmdWaitBatch({ timeout: 0 }, { session: 'sess-1', now: () => 5000, sleep: async () => {} });
  assert.equal(r.ready, false);
  assert.ok(readMeta(id).heartbeat > 1000, 'heartbeat bumped by the poll');
});

test('reviewReason names the batch and routes to review-spec', () => {
  const { batch } = specWithBatch();
  const text = reviewReason(pendingForSession('sess-1'));
  assert.match(text, /review-spec/);
  assert.ok(text.includes(batch.batchId));
});

test('Stop blocks on a pending batch — and it takes priority over drift', () => {
  const { id, batch } = specWithBatch('sess-1');
  // Also make it look like implementation drift; the batch must win.
  const m = readMeta(id); m.status = 'implementing'; writeMeta(id, m);
  appendEvent(id, { kind: 'pr', number: '#42', at: 't' });
  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes(batch.batchId));
  assert.match(out.reason, /review batch/i);
});

test('UserPromptSubmit surfaces pending batches as additionalContext', () => {
  specWithBatch('sess-1');
  const out = upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /review batch/i);
});

// ---------- Google Docs export relay ----------
function specWithExportRequest(session = 'sess-1') {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  attach(id, session);
  requestExport(id);
  return id;
}

test('Stop blocks on a queued export and routes to the export skill (surfaced once)', () => {
  const id = specWithExportRequest('sess-1');
  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /specforge:export/);
  assert.match(out.reason, /Google Docs/);
  assert.equal(readMeta(id).export.state, 'working', 'surfacing advances it so a re-Stop won’t repeat');
  assert.deepEqual(exportRequestsForSession('sess-1'), []);
});

test('a pending review batch takes priority over an export request', () => {
  const { id } = specWithBatch('sess-1');
  requestExport(id);
  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.match(out.reason, /review batch/i, 'the batch wins');
  assert.equal(readMeta(id).export.state, 'requested', 'the export waits, not consumed');
});

test('UserPromptSubmit surfaces a queued export as additionalContext', () => {
  specWithExportRequest('sess-1');
  const out = upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.match(out.hookSpecificOutput.additionalContext, /specforge:export/);
});

test('export CLI: working then done records the Doc link; --error records a failure', async () => {
  const id = specWithExportRequest('sess-1');
  assert.equal((await cmdExportWorking({ id })).ok, true);
  const d = await cmdExportDone({ id, url: 'https://docs.google.com/document/d/abc/edit' });
  assert.equal(d.ok, true);
  assert.equal(readMeta(id).export.state, 'done');
  assert.equal(readMeta(id).export.url, 'https://docs.google.com/document/d/abc/edit');

  requestExport(id);
  await cmdExportDone({ id, error: 'drive auth failed' });
  assert.equal(readMeta(id).export.state, 'error');
});

test('orphanedBatches: attached+fresh is not orphaned; unattached/stale is', () => {
  const { id } = specWithBatch('sess-1');
  assert.deepEqual(orphanedBatches(), []); // attached to a fresh session

  const m = readMeta(id); m.heartbeat = Date.now() - STALE_MS - 1; writeMeta(id, m);
  assert.equal(orphanedBatches().length, 1); // stale lock → orphaned
});

test('daemon drain tick fires the drain once for orphaned batches', async () => {
  let calls = 0;
  const drainer = createDaemonDrain({
    pending: () => [{ batchId: 'b_x', specId: 'z', threadIds: ['t'], title: 'Z' }],
    drain: async () => { calls++; },
  });
  await drainer.tick();
  assert.equal(calls, 1);
});

test('review CLI: comments → reply (claude) → batch-done', async () => {
  const { id, batch } = specWithBatch('sess-1');
  const c = await cmdComments({ id });
  assert.equal(c.pending.length, 1);
  assert.ok(c.htmlPath.endsWith('spec.html'));
  const tid = c.threads[0].id;

  const r = await cmdReply({ id, tid, body: 'fixed in §2' });
  assert.equal(r.ok, true);
  assert.equal(r.comment.author, 'claude');
  assert.equal(loadComments(id).threads[0].state, 'replied');

  const d = await cmdBatchDone({ id, batchId: batch.batchId });
  assert.equal(d.ok, true);
  assert.deepEqual(pendingForSession('sess-1'), []);
});

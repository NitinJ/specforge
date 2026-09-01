import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import {
  attach, specsForSession, setWatcher, clearWatcher, STALE_MS,
} from '../lib/attach.mjs';
import { loadComments, saveComments, createThread } from '../lib/store-comments.mjs';
import { submitBatch, reviewProgressForSpec, agentBusy } from '../lib/store-inbox.mjs';
import { readPublicationState } from '../lib/publication-state.mjs';
import {
  pendingForSession, reviewReason, watcherBeating, armWatcherReason,
} from '../lib/store-drain.mjs';
import { requestExport, exportRequestsForSession } from '../lib/store-export.mjs';
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
  // Addressed to the agent, since these tests exercise the batch drain.
  createThread(store, { anchor: { block: { index: 1, tag: 'P', text: 'the problem' } }, body: '@agent why?' });
  saveComments(id, store);
  const batch = submitBatch(id);
  return { id, batch };
}

// ---------- the reload hold ----------
// Answering a batch is many writes — a reply, a section rewritten, a table
// amended — and the page used to reload on each one, throwing the reader back to
// the top of a document still being edited. The round is the unit worth seeing.

test('a spec is busy from submit until the agent marks the batch done', async () => {
  const idle = createSpec({ title: 'B', html: '<h1>B</h1>' });
  assert.equal(agentBusy(idle), false, 'a spec nobody submitted is not busy');

  const { id, batch } = specWithBatch('sess-1');
  assert.equal(agentBusy(id), true, 'busy the moment the batch is submitted');
  assert.equal(agentBusy(idle), false, 'and only that spec');

  pendingForSession('sess-1');                                  // a hook surfaces it
  assert.equal(agentBusy(id), true, 'still busy once picked up');
  await cmdBatchWorking({ id, batchId: batch.batchId });
  assert.equal(agentBusy(id), true, 'still busy while the skill amends the spec');

  await cmdBatchDone({ id, batchId: batch.batchId });
  assert.equal(agentBusy(id), false, 'free once the round is finished');
});

test('the polled state carries the hold, so a published page can honour it', () => {
  const { id, batch } = specWithBatch('sess-1');
  assert.equal(readPublicationState(id).busy, true);
  return cmdBatchDone({ id, batchId: batch.batchId }).then(() => {
    const s = readPublicationState(id);
    assert.equal(s.busy, false);
    assert.ok(s.spec > 0, 'and still reports the mtimes it always did');
    assert.equal(typeof s.comments, 'number');
  });
});

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

test('Stop blocks on a pending batch — and it takes priority over a queued export', () => {
  const { id, batch } = specWithBatch('sess-1');
  requestExport(id); // both queued at once; the review batch must win
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
  assert.match(out.reason, /(^|\s)export/);
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
  assert.match(out.hookSpecificOutput.additionalContext, /(^|\s)export/);
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

// ---------- keeping a watcher armed ----------
//
// Nothing in code ever arms one: an agent reads an instruction and runs a
// background command, or forgets to. And the watcher exits every time it
// delivers a batch, because exiting is how it reports — so a session losing its
// watcher is normal operation, not an accident. Two things push back: a reminder
// at the moment it happens, and a check that looks at the fact.

/** A spec owned by `session`, with no watcher recorded. */
function owned(session) {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  attach(id, session);
  return id;
}

// The question is whether a watcher PROCESS is running, which the heartbeat
// cannot answer at the moment that matters: wait-batch exits to deliver a batch,
// leaving a beat that stays fresh for another half minute with nothing behind
// it — and that window is exactly when an agent finishes a review and settles.
test('a fresh heartbeat with no live watcher is not "beating"', () => {
  const id = owned('sess-1');
  writeMeta(id, { ...readMeta(id), heartbeat: Date.now() }); // as a just-exited watcher leaves it
  assert.equal(watcherBeating('sess-1'), false);
});

test('a recorded, living watcher is', () => {
  owned('sess-1');
  setWatcher('sess-1', process.pid); // this test process stands in for the watcher
  assert.equal(watcherBeating('sess-1'), true);
  assert.equal(watcherBeating('sess-2'), false, 'and only for that session');
});

test('a watcher that exited is not, however recent its last beat', () => {
  const id = owned('sess-1');
  setWatcher('sess-1', 0x7fffffff); // a pid that cannot be alive
  writeMeta(id, { ...readMeta(id), heartbeat: Date.now() });
  assert.equal(watcherBeating('sess-1'), false);
});

test('clearing the record ends it', () => {
  owned('sess-1');
  setWatcher('sess-1', process.pid);
  clearWatcher('sess-1');
  assert.equal(watcherBeating('sess-1'), false);
});

test('recording a watcher does not disturb the session’s spec list', () => {
  const a = owned('sess-1');
  setWatcher('sess-1', process.pid);
  const b = owned('sess-1');
  assert.deepEqual(specsForSession('sess-1').sort(), [a, b].sort());
  assert.equal(watcherBeating('sess-1'), true, 'and attaching did not wipe the watcher');
});

test('Stop refuses to settle while the session owns specs nobody watches', () => {
  const id = owned('sess-1');
  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.decision, 'block', 'settling in that state IS the bug');
  assert.ok(out.reason.includes(id), 'names the spec');
  assert.match(out.reason, /wait-batch/, 'and the command that fixes it');
});

test('Stop settles quietly once a watcher is running', () => {
  owned('sess-1');
  setWatcher('sess-1', process.pid);
  assert.equal(stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
});

test('the nag cannot loop — the stop-guard caps it at one per settle', () => {
  owned('sess-1');
  assert.equal(stopRun({ stop_hook_active: true }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
});

test('a pending batch outranks the nag, and its own text says to re-arm', () => {
  // Both are true at once for a session with no watcher and a waiting batch.
  // The batch is the urgent one, and reviewReason now carries the reminder, so
  // nothing is lost by it winning.
  specWithBatch('sess-1');
  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.match(out.reason, /review batch/i, 'the batch wins');
  assert.match(out.reason, /re-arm the review watcher/, 'and still says to re-arm');
});

test('armWatcherReason names every unwatched spec and the exact command', () => {
  const a = owned('sess-1', 10 * 60 * 1000);
  const b = owned('sess-1', 10 * 60 * 1000);
  const text = armWatcherReason([a, b]);
  assert.ok(text.includes(a) && text.includes(b));
  assert.match(text, /sit unread/, 'says what it costs');
  assert.match(text, /specforge-cli\.mjs" wait-batch/, 'a command that can be run as written');
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

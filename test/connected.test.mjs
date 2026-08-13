// What "connected" means, and who is allowed to say it.
//
// The question a reader actually has is: if I submit these comments, will anyone
// see them? Only the review watcher can answer yes — it is the loop that notices
// a batch while the session sits idle — so only the watcher beats. A turn in the
// window proves the window exists, which is a different and much weaker claim,
// and treating it as proof left specs reading "live" for the half hour their
// lock took to go stale after the window had closed.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { attach, heartbeat, isConnected, isStale, CONNECTED_MS, STALE_MS } from '../lib/attach.mjs';
import { specConnected } from '../lib/spec-signals.mjs';
import { mutateComments, createThread } from '../lib/store-comments.mjs';
import { submitBatch, markBatchDone } from '../lib/store-inbox.mjs';

const anchor = { block: { index: 1, tag: 'P', text: 'a block' } };

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-conn-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** A spec attached to `session`, with its heartbeat backdated by `agoMs`. */
function attached(agoMs = 0, session = 'sess-1') {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  attach(id, session);
  const m = readMeta(id);
  writeMeta(id, { ...m, heartbeat: Date.now() - agoMs });
  return id;
}

test('an unattached spec is never connected', () => {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  assert.equal(isConnected(readMeta(id)), false);
  assert.equal(specConnected(id), false);
});

test('a fresh beat is connected; two missed beats is not', () => {
  assert.equal(isConnected(readMeta(attached(0))), true, 'just beat');
  assert.equal(isConnected(readMeta(attached(CONNECTED_MS - 1000))), true, 'one beat missed is tolerated');
  assert.equal(isConnected(readMeta(attached(CONNECTED_MS + 1000))), false, 'two missed and it is gone');
});

// The window that made the old badge a lie: a session closed 20 minutes ago
// still held its lock, and the index read the lock as liveness.
test('a spec that has not beaten for 20 minutes is disconnected but still locked', () => {
  const id = attached(20 * 60 * 1000);
  assert.equal(isConnected(readMeta(id)), false, 'nobody is listening');
  assert.equal(isStale(readMeta(id)), false, 'but the lock is still that session\'s');
  assert.ok(CONNECTED_MS < STALE_MS, 'the two answer different questions');
});

test('the watcher beat is what makes a spec connected', () => {
  const id = attached(60 * 60 * 1000);
  assert.equal(specConnected(id), false);
  heartbeat('sess-1');                       // one poll of `specforge wait-batch`
  assert.equal(specConnected(id), true);
});

// The watcher stops the moment it hands a batch over, so a strict beat test
// would report "disconnected" for the whole time an agent is answering the
// comments you just submitted.
test('a batch in flight counts as connected even though nothing is beating', () => {
  // Beyond two missed beats, but only minutes: the watcher stopped because it
  // handed this batch over, which is what being answered looks like.
  const id = attached(5 * 60 * 1000);
  mutateComments(id, (s) => createThread(s, { anchor, body: '@agent why?', author: 'human' }));
  const batch = submitBatch(id);
  assert.equal(specConnected(id), true, 'the comments were picked up — that is the proof');

  markBatchDone(id, batch.batchId);
  assert.equal(specConnected(id), false, 'and once the round is over, the beat has to resume');
});

// Otherwise the batch-in-flight exception replaces one false positive with
// another: a session that died mid-round never marks its batch done, and the
// spec would claim to be connected to it for good.
test('a batch in flight stops counting once the session has gone quiet for good', () => {
  const id = attached(STALE_MS + 60 * 1000);
  mutateComments(id, (s) => createThread(s, { anchor, body: '@agent why?', author: 'human' }));
  submitBatch(id);
  assert.equal(isStale(readMeta(id)), true, 'nothing has been heard from that session at all');
  assert.equal(specConnected(id), false, 'so its unfinished round is a leftover, not work');
});

test('a batch in flight on an unattached spec is still not connected', () => {
  // Nothing owns it, so nothing is going to answer. A pending batch here is a
  // leftover, not a session at work.
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  mutateComments(id, (s) => createThread(s, { anchor, body: '@agent why?', author: 'human' }));
  submitBatch(id);
  assert.equal(specConnected(id), false);
});

// A beat is not an edit. Stamping `updated` every 15s pinned every attached
// spec to the present, which made the index's recency sort meaningless.
test('beating does not count as touching the document', () => {
  const id = attached(60 * 1000);
  const before = readMeta(id).updated;
  heartbeat('sess-1');
  const after = readMeta(id);
  assert.equal(after.updated, before, '`updated` is when the spec changed, not when it was polled');
  assert.ok(after.heartbeat > Date.now() - 5000, 'and the beat did land');
});

test('beating touches only the beating session\'s specs', () => {
  const mine = attached(60 * 60 * 1000, 'sess-1');
  const theirs = attached(60 * 60 * 1000, 'sess-2');
  heartbeat('sess-1');
  assert.equal(specConnected(mine), true);
  assert.equal(specConnected(theirs), false);
});

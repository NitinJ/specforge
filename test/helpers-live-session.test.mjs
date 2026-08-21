// The live-session helper, checked against the thing it has to fool.
//
// Every later stage decides whether to accept work by asking attach.mjs whether
// a session's watcher is running. A helper that wrote a record attach.mjs read
// as dead would make every "no session" test pass for the wrong reason, and
// every "session available" test impossible to write.
//
// Spec 45395008a2, task 0.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession, seedDeadSession, seedSession } from './helpers/live-session.mjs';
import { watcherAlive } from '../lib/attach.mjs';
import { sessionPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-livesess-');

test('a seeded live session reads as alive to attach.mjs', () => {
  const { id } = seedLiveSession();
  assert.equal(watcherAlive(id), true);
});

test('a seeded dead session reads as dead', () => {
  // The ordinary state of a store: the window that owned this closed hours ago
  // and left its record behind.
  const { id } = seedDeadSession({ id: 'sess-gone' });
  assert.equal(watcherAlive(id), false);
});

test('a session nobody seeded is dead, not an error', () => {
  assert.equal(watcherAlive('sess-never-existed'), false);
});

test('the record is the shape attach.mjs writes', () => {
  // readSessionRecord defaults both fields, so a wrong shape degrades to empty
  // rather than throwing, which would hide a broken helper behind passing tests.
  const { id } = seedLiveSession();
  const raw = JSON.parse(readFileSync(sessionPath(id), 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), ['specs', 'watcherPid']);
  assert.deepEqual(raw.specs, [], 'no owned specs: ownership is attach()\'s to write');
  assert.equal(raw.watcherPid, process.pid);
});

test('owning a spec goes through attach, and the helper does not fake it', async () => {
  // The trap this closes (raised in review of PR #221): writing spec ids into
  // the record's reverse index alone produces a session that looks like it owns
  // them while specsForSession returns nothing, because meta.attachedSession is
  // the source of truth and the index is only a cache of it.
  const { createSpec } = await import('../lib/store.mjs');
  const { attach, specsForSession } = await import('../lib/attach.mjs');
  const { id } = seedLiveSession({ id: 'sess-owner' });
  assert.deepEqual(specsForSession(id), [], 'a seeded session owns nothing');

  const specId = createSpec({ title: 'Owned', html: '<h1>Owned</h1>' });
  attach(specId, id);
  assert.deepEqual(specsForSession(id), [specId], 'attach is what makes it real');
  assert.equal(watcherAlive(id), true, 'and the watcher is still the live one');
});

test('two seeded sessions do not collide', () => {
  const a = seedLiveSession({ id: 'sess-a' });
  const b = seedDeadSession({ id: 'sess-b' });
  assert.equal(watcherAlive(a.id), true);
  assert.equal(watcherAlive(b.id), false);
});

test('seedSession takes alive as a parameter, so a test can say which it means', () => {
  assert.equal(watcherAlive(seedSession({ id: 's1', alive: true }).id), true);
  assert.equal(watcherAlive(seedSession({ id: 's2', alive: false }).id), false);
});

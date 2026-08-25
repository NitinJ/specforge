// Ownership, once a session is named by a harness-qualified key.
//
// The riskiest change in the whole spec lives here. Every one of the 111 specs
// in the store holds a bare session id in meta.attachedSession, and the running
// session now reports `claude:<id>`. If those two ever stop comparing equal,
// every spec reads as detached at once and nothing says so (I2).
//
// Spec e9ddcddef6, tasks 1.2 and 1.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSession, seedLegacySession } from './helpers/live-session.mjs';
import { attach, detach, specsForSession, watcherAlive, liveSessions } from '../lib/attach.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { metaPath, sessionPath } from '../lib/store-paths.mjs';
import { mineFor } from '../hooks/lib/session.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-attachkeys-');

const newSpec = (title = 'A spec') => createSpec({ title, html: `<h1>${title}</h1>` });

/** Write meta.attachedSession by hand, to reproduce what the store already holds. */
function setLegacyOwner(specId, rawId) {
  const meta = readMeta(specId);
  writeFileSync(metaPath(specId), JSON.stringify({ ...meta, attachedSession: rawId }, null, 2));
}

// --- I2: the migration ------------------------------------------------------

test('a spec attached before harnesses existed is still owned by the same session', () => {
  // The exact pre-upgrade shape: a bare id in meta, a bare filename on disk.
  const { id: raw, key } = seedLegacySession({ id: 'legacy-sess' });
  const specId = newSpec();
  setLegacyOwner(specId, raw);

  assert.deepEqual(specsForSession(key), [], 'the reverse index has not been written yet');
  // The index is a cache; meta is the truth. Seed the index the way attach would.
  writeFileSync(sessionPath('legacy-sess'), JSON.stringify({ specs: [specId], watcherPid: process.pid }, null, 2));

  assert.deepEqual(specsForSession(key), [specId], 'the qualified key finds it');
  assert.deepEqual(specsForSession(raw), [specId], 'and so does the bare one');
});

test('a legacy session record is found by its qualified key', () => {
  const { id: raw, key } = seedLegacySession({ id: 'legacy-2' });
  assert.equal(watcherAlive(key), true, 'the key reaches the bare filename');
  assert.equal(watcherAlive(raw), true, 'and so does the raw id');
});

test('attaching writes the qualified key, and the bare filename stays put', () => {
  const specId = newSpec();
  attach(specId, 'claude:sess-1');
  assert.equal(readMeta(specId).attachedSession, 'claude:sess-1');
  assert.ok(existsSync(sessionPath('sess-1')), 'no file on disk gained a prefix');
});

test('attaching by raw id records the qualified form', () => {
  // What the CLI does when a caller passes --session with a bare id.
  const specId = newSpec();
  attach(specId, 'sess-2');
  assert.equal(readMeta(specId).attachedSession, 'claude:sess-2');
});

test('re-attaching the same session in either form is idempotent, not a conflict', () => {
  const specId = newSpec();
  attach(specId, 'sess-3');
  attach(specId, 'claude:sess-3');
  assert.deepEqual(specsForSession('claude:sess-3'), [specId]);
});

// --- I1: two harnesses --------------------------------------------------------

test('two harnesses issuing one raw id own disjoint sets of specs (I1)', () => {
  const a = seedSession({ id: 'same-raw', harness: 'claude' });
  const b = seedSession({ id: 'same-raw', harness: 'pi' });
  const specA = newSpec('For Claude');
  const specB = newSpec('For Pi');

  attach(specA, a.key);
  attach(specB, b.key);

  assert.deepEqual(specsForSession(a.key), [specA]);
  assert.deepEqual(specsForSession(b.key), [specB]);
});

test('one harness cannot take a spec the other holds', () => {
  const a = seedSession({ id: 'same-raw', harness: 'claude' });
  const b = seedSession({ id: 'same-raw', harness: 'pi' });
  const specId = newSpec();
  attach(specId, a.key);
  assert.throws(() => attach(specId, b.key), /attached to another session/);
});

test('their session records are separate files (I12)', () => {
  seedSession({ id: 'same-raw', harness: 'claude' });
  seedSession({ id: 'same-raw', harness: 'pi' });
  assert.ok(existsSync(sessionPath('same-raw')), 'Claude Code keeps the bare name');
  assert.ok(existsSync(sessionPath('pi__same-raw')), 'and Pi encodes its prefix');
});

test('a watcher alive under one harness is not alive under the other', () => {
  seedSession({ id: 'same-raw', harness: 'claude', alive: true });
  seedSession({ id: 'same-raw', harness: 'pi', alive: false });
  assert.equal(watcherAlive('claude:same-raw'), true);
  assert.equal(watcherAlive('pi:same-raw'), false);
});

test('liveSessions reports keys, not filenames', () => {
  seedSession({ id: 'l1', harness: 'pi', alive: true });
  const live = liveSessions();
  assert.ok(live.includes('pi:l1'), `got ${JSON.stringify(live)}`);
  assert.equal(live.some((s) => s.includes('__')), false, 'no encoded name leaks out');
});

// --- detach -----------------------------------------------------------------

test('detach works whichever form the spec recorded', () => {
  const specId = newSpec();
  setLegacyOwner(specId, 'old-owner');
  detach(specId);
  assert.equal(readMeta(specId).attachedSession, null);
});

// --- E5: the idle gate ------------------------------------------------------

test('a session that owns nothing returns immediately, owning nothing', () => {
  const { mine, me } = mineFor({ CLAUDE_CODE_SESSION_ID: 'nobody' });
  assert.equal(me, 'claude:nobody');
  assert.deepEqual(mine, []);
});

test('a hook with no session identity gates out before reading anything', () => {
  const { me, mine } = mineFor({});
  assert.equal(me, '');
  assert.deepEqual(mine, []);
});

test('the gate prefers the payload session id over the environment', () => {
  const { id, key } = seedSession({ id: 'from-payload' });
  const specId = newSpec();
  attach(specId, key);
  const { me, mine } = mineFor({ CLAUDE_CODE_SESSION_ID: 'from-env' }, { session_id: id });
  assert.equal(me, key);
  assert.deepEqual(mine, [specId]);
});

test('the gate accepts a bare session id as its payload argument', () => {
  // The older call shape, which passed the id rather than the whole payload.
  const { id, key } = seedSession({ id: 'bare-arg' });
  const specId = newSpec();
  attach(specId, key);
  assert.deepEqual(mineFor({}, id).mine, [specId]);
});

test('the gate reports which harness answered', () => {
  assert.equal(mineFor({ CLAUDE_CODE_SESSION_ID: 'x' }).harness.id, 'claude');
});

// --- unusable session ids ---------------------------------------------------
//
// `--session` takes whatever it is given, so these reach the store from the
// command line. Raised in review of PR #231.

test('a session id that cannot be stored safely is refused, not attached', () => {
  const specId = newSpec();
  for (const bad of ['claude:..', 'claude:.', '']) {
    assert.throws(() => attach(specId, bad), /unusable session id|unknown spec/, bad);
  }
  assert.equal(readMeta(specId).attachedSession, null, 'and the spec stays free');
});

test('a traversing session id writes no file outside the sessions directory', () => {
  const specId = newSpec();
  attach(specId, 'claude:../../escape');
  // It attaches, because the id is storable once escaped. What matters is where.
  assert.ok(existsSync(sessionPath('..%2F..%2Fescape')), 'escaped into one flat name');
  assert.deepEqual(specsForSession('claude:../../escape'), [specId]);
});

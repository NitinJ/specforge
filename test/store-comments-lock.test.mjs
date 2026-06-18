// Concurrency hardening for comments.json: atomic saveComments + the per-spec
// lock that serializes the read-modify-write across the daemon (human actions)
// and the agent CLI (claude replies). A true cross-process lost-update test needs
// real subprocesses; these cover the building blocks — atomicity, mutate
// correctness, lock release (success + throw), and stale-lock reclaim.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, openSync, closeSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadComments, saveComments, mutateComments, withCommentsLock } from '../lib/store-comments.mjs';
import { specDir, commentsPath, commentsLockPath } from '../lib/store-paths.mjs';

let home;
let prevHome;
const ID = 'spec123abc';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-lock-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('saveComments writes atomically — round-trips and leaves no temp file', () => {
  saveComments(ID, { specId: ID, threads: [{ id: 't1', state: 'open', comments: [] }] });
  assert.equal(loadComments(ID).threads.length, 1);
  const leftovers = readdirSync(specDir(ID)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'no .tmp file left behind');
});

test('mutateComments applies + persists the mutation and returns the callback result', () => {
  saveComments(ID, { specId: ID, threads: [] });
  const ret = mutateComments(ID, (store) => {
    store.threads.push({ id: 't1', state: 'open', comments: [] });
    return 'ok';
  });
  assert.equal(ret, 'ok');
  assert.equal(loadComments(ID).threads.length, 1);
});

test('mutateComments releases the lock on success and on throw', () => {
  saveComments(ID, { specId: ID, threads: [] });
  mutateComments(ID, (s) => s);
  assert.equal(existsSync(commentsLockPath(ID)), false, 'released after success');
  assert.throws(() => mutateComments(ID, () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(commentsLockPath(ID)), false, 'released after throw');
});

test('mutateComments skips the write when fn makes no change (no mtime churn)', () => {
  mutateComments(ID, (s) => s); // no-op on a spec with no comments.json yet
  assert.equal(existsSync(commentsPath(ID)), false, 'a no-op mutation did not write the file');
});

test('best-effort fallback does not delete a lock it never acquired', () => {
  mkdirSync(specDir(ID), { recursive: true });
  const lock = commentsLockPath(ID);
  closeSync(openSync(lock, 'wx')); // a fresh (non-stale) lock held by "another process"
  withCommentsLock(ID, () => {}); // can't acquire within the budget → proceeds best-effort
  assert.equal(existsSync(lock), true, "did not delete the other holder's lock");
  rmSync(lock, { force: true });
});

test('withCommentsLock reclaims a stale lock', () => {
  mkdirSync(specDir(ID), { recursive: true });
  const lock = commentsLockPath(ID);
  closeSync(openSync(lock, 'wx'));        // hold the lock
  const old = Date.now() / 1000 - 60;     // age it 60s (past the 5s stale threshold)
  utimesSync(lock, old, old);
  let ran = false;
  withCommentsLock(ID, () => { ran = true; });
  assert.ok(ran, 'reclaimed the stale lock and ran the critical section');
  assert.equal(existsSync(lock), false, 'lock released afterward');
});

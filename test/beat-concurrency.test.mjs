// The lock the watcher beat writes under.
//
// A shared spec has one writer per connected harness, each beating every fifteen
// seconds, and each beat is a read-modify-write of the whole meta.json. Two of
// them can interleave and lose an update. Raised in review of #235.
//
// **What is and is not at risk, measured rather than assumed.** A steady-state
// beat is close to harmless: every beat re-reads, so a clobbered one is repaired
// fifteen seconds later, and the record it clobbers already existed in the
// snapshot it overwrote. A race between two processes beating in a loop is
// therefore not reproducible, and a test that stages one passes against unlocked
// code, which is worse than no test.
//
// The case that is not self-healing is a write that CREATES something during a
// beat's window: a second harness connecting, or a rename. That write has no
// later beat to restore it, so losing it is permanent. That is what the lock is
// for, and what these tests cover: the exclusion itself, deterministically,
// rather than a race staged in the hope that it lands.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, utimesSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

import { useTempStore } from './helpers/temp-store.mjs';
import { withFileLock } from '../lib/file-lock.mjs';
import { metaLockPath, commentsLockPath, specDir } from '../lib/store-paths.mjs';
import { createSpec } from '../lib/store.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-lock-');

test('the lock is held for the whole of fn, and released after', () => {
  const path = join(specDir(createSpec({ title: 'A', html: '<h1>a</h1>' })), 'x.lock');
  let heldDuring = false;
  withFileLock(path, () => { heldDuring = existsSync(path); });
  assert.equal(heldDuring, true, 'nothing else could have taken it');
  assert.equal(existsSync(path), false, 'and it does not leak');
});

test('a lock held by someone else is waited for, not ignored', () => {
  // The wait budget is three seconds, so a held lock costs real time. Measured
  // rather than asserted: a lock that returned immediately would look identical
  // from the outside.
  const path = join(specDir(createSpec({ title: 'A', html: '<h1>a</h1>' })), 'y.lock');
  writeFileSync(path, ''); // a live holder, from this instant

  const started = Date.now();
  withFileLock(path, () => {});
  const waited = Date.now() - started;

  assert.ok(waited >= 100, `gave up after ${waited}ms without waiting`);
});

test('it proceeds anyway rather than hanging when the wait runs out', () => {
  // A heartbeat that blocks is worse than one that races: the next beat is
  // fifteen seconds away, and a wedged watcher takes the session's whole review
  // loop with it.
  const path = join(specDir(createSpec({ title: 'A', html: '<h1>a</h1>' })), 'z.lock');
  writeFileSync(path, '');
  let ran = false;
  withFileLock(path, () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(existsSync(path), true, 'and it left the real holder’s lock alone');
});

test('a lock whose holder died is reclaimed', () => {
  const path = join(specDir(createSpec({ title: 'A', html: '<h1>a</h1>' })), 'w.lock');
  writeFileSync(path, '');
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old); // older than LOCK_STALE_MS

  let ran = false;
  withFileLock(path, () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(existsSync(path), false, 'reclaimed and then released');
});

test('meta and comments take separate locks', () => {
  // A beat waiting on a comment reply would be a queue nobody asked for.
  const id = createSpec({ title: 'A', html: '<h1>a</h1>' });
  assert.notEqual(metaLockPath(id), commentsLockPath(id));
});

test('every read-modify-write of meta.json goes through the lock', () => {
  // A lock only one writer takes is not a lock. Greptile made exactly this point
  // on #235: the beat took `meta.lock` while the browser and CLI paths still did
  // an unlocked readMeta-then-writeMeta, so the lost update it was meant to
  // prevent stayed reachable from the other side.
  //
  // Pinned as a scan rather than left to review: the failure is silent, and the
  // next person to add a field will reach for readMeta + writeMeta because that
  // is what the rest of the file looks like.
  const root = resolve(HERE, '..', 'lib');
  const offenders = [];

  for (const file of readdirSync(root).filter((f) => f.endsWith('.mjs'))) {
    // meta.mjs defines both, and mutateMeta is built out of them.
    if (file === 'meta.mjs') continue;
    const src = readFileSync(join(root, file), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bwriteMeta\(/.test(line)) return;
      // Writing a freshly built object is not a read-modify-write: there is no
      // earlier read to lose. Creating a spec and seeding a template both build
      // from `defaultMeta`, and the seed spreads it over a couple of lines.
      if (/defaultMeta\(/.test(line) || /defaultMeta\(/.test(lines[i + 1] || '')) return;
      offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }

  assert.deepEqual(offenders, [],
    'these read meta and write it back without the lock; use mutateMeta:\n  '
    + offenders.join('\n  '));
});

test('an error inside fn still releases the lock', () => {
  // A watcher that threw once and left its lock behind would block every later
  // beat for LOCK_STALE_MS, on every process.
  const path = join(specDir(createSpec({ title: 'A', html: '<h1>a</h1>' })), 'e.lock');
  assert.throws(() => withFileLock(path, () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(path), false);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { sessionPath } from '../lib/store-paths.mjs';
import {
  attach, detach, heartbeat, specsForSession, isStale, STALE_MS, recordFirstPrompt,
} from '../lib/attach.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-attach-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('attach binds a spec to a session and records it in the reverse index', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const meta = readMeta(id);
  assert.equal(meta.attachedSession, 'sess-1');
  assert.ok(meta.heartbeat > 0);
  assert.deepEqual(specsForSession('sess-1'), [id]);
  assert.ok(existsSync(sessionPath('sess-1')));
});

test('attach is idempotent for the owning session', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  attach(id, 'sess-1'); // no throw, still owned by sess-1
  assert.equal(readMeta(id).attachedSession, 'sess-1');
  assert.deepEqual(specsForSession('sess-1'), [id]);
});

test('attach is exclusive — a second live session cannot steal it', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  assert.throws(() => attach(id, 'sess-2'), /attached to another session/);
  assert.equal(readMeta(id).attachedSession, 'sess-1');
});

test('a stale lock can be reclaimed by another session', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  // Age sess-1's heartbeat past the stale window.
  const meta = readMeta(id);
  meta.heartbeat = Date.now() - STALE_MS - 1000;
  writeMeta(id, meta);
  attach(id, 'sess-2'); // reclaim succeeds
  assert.equal(readMeta(id).attachedSession, 'sess-2');
  assert.deepEqual(specsForSession('sess-2'), [id]);
});

test('isStale reflects heartbeat age only for attached specs', () => {
  const id = createSpec({ title: 'A' });
  assert.equal(isStale(readMeta(id)), false); // unattached → never "stale"
  attach(id, 'sess-1');
  assert.equal(isStale(readMeta(id)), false); // fresh heartbeat
  const meta = readMeta(id);
  meta.heartbeat = Date.now() - STALE_MS - 1;
  writeMeta(id, meta);
  assert.equal(isStale(meta), true);
});

test('detach frees the spec and drops it from the reverse index', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  detach(id);
  assert.equal(readMeta(id).attachedSession, null);
  assert.deepEqual(specsForSession('sess-1'), []);
});

test('attach captures the project folder as the session label; detach clears it', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1', '/home/nitin/workspace/figur');
  assert.equal(readMeta(id).sessionCwd, 'figur');
  detach(id);
  assert.equal(readMeta(id).sessionCwd, null);
  assert.equal(readMeta(id).sessionPrompt, null);
});

test('recordFirstPrompt stamps the first prompt once, then leaves it', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1', '/tmp/proj');
  assert.equal(recordFirstPrompt('sess-1', '  build the  thing\n'), 1);
  assert.equal(readMeta(id).sessionPrompt, 'build the thing');
  assert.equal(recordFirstPrompt('sess-1', 'a later prompt'), 0, 'not overwritten');
  assert.equal(readMeta(id).sessionPrompt, 'build the thing');
});

test('reclaiming a stale lock resets the first prompt for the new owner', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1', '/tmp/proj');
  recordFirstPrompt('sess-1', 'first owner prompt');
  const m = readMeta(id);
  m.heartbeat = Date.now() - STALE_MS - 1;
  writeMeta(id, m);
  attach(id, 'sess-2', '/tmp/other');
  assert.equal(readMeta(id).sessionPrompt, null, 'new owner starts fresh');
  assert.equal(readMeta(id).sessionCwd, 'other');
});

test('heartbeat bumps every spec the session owns', () => {
  const a = createSpec({ title: 'A' });
  const b = createSpec({ title: 'B' });
  attach(a, 'sess-1');
  attach(b, 'sess-1');
  // Backdate both heartbeats.
  for (const id of [a, b]) {
    const m = readMeta(id);
    m.heartbeat = 1000;
    writeMeta(id, m);
  }
  const n = heartbeat('sess-1');
  assert.equal(n, 2);
  assert.ok(readMeta(a).heartbeat > 1000);
  assert.ok(readMeta(b).heartbeat > 1000);
});

test('specsForSession self-heals when the reverse index is stale', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  // Simulate the reverse index going stale: meta says sess-2 now owns the spec,
  // but sess-1's reverse-index file still lists it.
  const meta = readMeta(id);
  meta.attachedSession = 'sess-2';
  writeMeta(id, meta);
  // Reverse index for sess-1 still lists `id`, but meta says sess-2 owns it.
  assert.deepEqual(specsForSession('sess-1'), []);
});

test('two sessions own disjoint specs without collision', () => {
  const a = createSpec({ title: 'A' });
  const b = createSpec({ title: 'B' });
  attach(a, 'sess-1');
  attach(b, 'sess-2');
  assert.deepEqual(specsForSession('sess-1'), [a]);
  assert.deepEqual(specsForSession('sess-2'), [b]);
  assert.equal(readMeta(a).attachedSession, 'sess-1');
  assert.equal(readMeta(b).attachedSession, 'sess-2');
});

test('specsForSession is empty for an unknown session', () => {
  assert.deepEqual(specsForSession('nobody'), []);
  assert.deepEqual(specsForSession(''), []);
});

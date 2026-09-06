// Self-tests for the Stage 0 harness.
//
// A harness that silently does the wrong thing turns a later stage's red test
// into a hunt through production code, so each piece asserts its own claim here.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { startDaemon, startGateway } from './helpers/daemon-harness.mjs';
import {
  poison, unpoisonAll, needsPoison, moverFailingAt, makeUnoverwritable,
} from './helpers/fs-probe.mjs';
import { specDir, specHtmlPath } from '../lib/store-paths.mjs';

const store = useTempStore({ beforeEach, afterEach }, 'sf-harness-');

let d;
afterEach(async () => {
  unpoisonAll();
  if (d) { await d.close(); d = null; }
});

test('the daemon harness serves a seeded spec', async () => {
  const id = seedSpec({ title: 'Served' });
  d = await startDaemon();
  const res = await d.get(`/spec/${id}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Served/);
});

test('the daemon harness satisfies the CSRF guard on writes', async () => {
  const id = seedSpec({ title: 'Writable' });
  d = await startDaemon();
  const res = await d.patch(`/api/spec/${id}/organize`, { collection: 'Box' });
  // The point is that it is not a 403 from the origin guard.
  assert.notEqual(res.status, 403);
  assert.equal(res.status, 200);
});

test('a write from another origin is refused, which is what the harness must not trip', async () => {
  const id = seedSpec({ title: 'Guarded' });
  d = await startDaemon();
  const res = await fetch(`${d.base}/api/spec/${id}/organize`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
    body: JSON.stringify({ collection: 'Box' }),
  });
  assert.equal(res.status, 403);
});

test('a write with no Origin at all is allowed: that is the CLI, and the tests', async () => {
  const id = seedSpec({ title: 'Headless' });
  d = await startDaemon();
  const res = await fetch(`${d.base}/api/spec/${id}/organize`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection: 'Box' }),
  });
  assert.equal(res.status, 200);
});

test('json() returns status and parsed body together', async () => {
  const id = seedSpec({ title: 'Meta please' });
  d = await startDaemon();
  const { status, body } = await d.json(`/api/spec/${id}/meta`);
  assert.equal(status, 200);
  assert.equal(body.title, 'Meta please');
});

test('close returns even with an SSE stream still open', async () => {
  const id = seedSpec({ title: 'Streaming' });
  const local = await startDaemon();

  // /events never completes by design. server.close() waits for open
  // connections, so without socket tracking this teardown hangs the run.
  const controller = new AbortController();
  const stream = fetch(`${local.base}/events?spec=${id}`, { signal: controller.signal });
  await new Promise((r) => { setTimeout(r, 100); });

  const closed = await Promise.race([
    local.close().then(() => 'closed'),
    new Promise((r) => { setTimeout(() => r('hung'), 3000); }),
  ]);
  assert.equal(closed, 'closed', 'close() hung on the open SSE stream');

  controller.abort();
  await stream.catch(() => {});
});

test('the gateway harness issues a token that serves its spec', async () => {
  const id = seedSpec({ title: 'Shared' });
  d = await startGateway();
  const token = d.share(id);
  const res = await d.get(`/s/${token}`);
  assert.equal(res.status, 200);
});

test('the gateway refuses an unknown token', async () => {
  seedSpec({ title: 'Private' });
  d = await startGateway();
  const res = await d.get('/s/deadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.status, 404);
});

test('poison makes a file unreadable, so a reader fails loudly', needsPoison, () => {
  const id = seedSpec({ title: 'Poisoned' });
  const path = specHtmlPath(id);
  assert.ok(readFileSync(path, 'utf8').length > 0);
  poison(path);
  assert.throws(() => readFileSync(path, 'utf8'), (e) => e.code === 'EACCES');
  unpoisonAll();
  assert.ok(readFileSync(path, 'utf8').length > 0);
});

test('moverFailingAt moves until the chosen call, then throws', () => {
  const a = seedSpec({ title: 'A' });
  const b = seedSpec({ title: 'B' });
  const dest = join(store.dir, 'moved');
  mkdirSync(dest, { recursive: true });

  const { move, calls } = moverFailingAt(2);
  move(specDir(a), join(dest, a));
  assert.ok(existsSync(join(dest, a)));

  assert.throws(() => move(specDir(b), join(dest, b)), (e) => e.code === 'EACCES');
  assert.equal(calls.length, 2);
  // The second spec is still where it was: the failure did not half-move it.
  assert.ok(existsSync(specDir(b)));
});

test('the scratch store is disposable and refuses to delete anything outside /tmp', async () => {
  const { makeScratchStore, removeScratchStore } = await import('./helpers/scratch-store.mjs');
  const scratch = makeScratchStore('sf-scratch-selftest-');
  assert.ok(existsSync(scratch.dir));
  assert.match(scratch.hint, /^SPECFORGE_HOME=\//);
  assert.equal(scratch.env.SPECFORGE_HOME, scratch.dir);

  assert.throws(() => removeScratchStore('/home/nitin/.specforge'), /refusing to remove/);
  // A prefix check passes this and a recursive delete then leaves the temp dir.
  assert.throws(() => removeScratchStore(`${tmpdir()}/../home`), /refusing to remove/);
  assert.throws(() => removeScratchStore(tmpdir()), /refusing to remove/);
  assert.throws(() => removeScratchStore(''), /refusing to remove/);
  assert.throws(() => removeScratchStore(null), /refusing to remove/);

  removeScratchStore(scratch.dir);
  assert.equal(existsSync(scratch.dir), false);
});

test('makeUnoverwritable blocks a rename onto that directory', () => {
  const id = seedSpec({ title: 'Blocked' });
  const dest = join(store.dir, 'occupied-target');
  makeUnoverwritable(dest);
  assert.throws(() => renameSync(specDir(id), dest), (e) => e.code === 'ENOTEMPTY' || e.code === 'EEXIST');
});

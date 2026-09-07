// A reparent must not land in the middle of a subtree delete.
//
// The DELETE route reads its plan, revokes every share in the subtree and only
// then moves the directories, and `deleteSubtree` re-reads membership before
// the first move so a spec reparented out in between is left standing. That
// re-read is right — deleting a spec whose share was never revoked is worse —
// but it leaves the other half: the survivor's public link has already been
// revoked, and the token is gone, so nothing can put it back. A reader holding
// that link now gets a 404 for a spec nobody deleted.
//
// The reparent is the half to refuse. It costs a retry; the revocation costs a
// link that was handed out.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { createDaemon } from '../server/daemon.mjs';
import { createPublications } from '../lib/publications.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specDir } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-delrace-');

/**
 * A daemon whose revoke phase can be held open.
 *
 * The race only exists between the first revoke and the first move, which in a
 * real run is microseconds. `gate` widens that window to whatever the test
 * needs, and wraps the registry rather than replacing it so `isDeleting` is the
 * real set the real `unshareThen` maintains.
 */
async function withStalledDelete(t) {
  const real = createPublications({
    publishImpl: async (port) => ({
      url: `http://127.0.0.1:${port}`, pid: 1, stop: async () => {},
    }),
    killImpl: () => {}, aliveImpl: () => true, ownsImpl: () => true,
    probeImpl: async () => true, sleepImpl: async () => {}, port: 0,
  });

  let release;
  const gate = new Promise((r) => { release = r; });
  let held;
  const reached = new Promise((r) => { held = r; });

  const pubs = {
    ...real,
    async holdSubtree(ids, fn) {
      return real.holdSubtree(ids, async () => {
        held(ids);
        await gate;
        return fn();
      });
    },
  };

  const server = createDaemon({ publications: pubs });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    release();
    await new Promise((r) => server.close(r));
    await real.stopAll();
  });

  const patch = (path, body) => fetch(base + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  });

  return { base, patch, gate: { release, reached } };
}

test('a reparent aimed at a spec a delete is holding is refused', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const elsewhere = seedSpec({ title: 'Elsewhere' });

  const d = await withStalledDelete(t);
  const deleting = fetch(`${d.base}/api/spec/${root}`, { method: 'DELETE', headers: { Origin: d.base } });
  await d.gate.reached;

  const res = await d.patch(`/api/spec/${child}/organize`, { parent: elsewhere });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'spec is being deleted');
  assert.equal(readMeta(child).parent, root, 'the reparent was refused and still wrote');

  d.gate.release();
  await deleting;
  // And the delete then takes the child it planned for, with its share revoked
  // rather than left live.
  assert.equal(existsSync(specDir(child)), false);
});

test('a move that is not a reparent still lands during a delete', async (t) => {
  // The refusal is about the tree edge, which is the only field that can change
  // what a running delete covers. Filing a spec elsewhere does not.
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  const d = await withStalledDelete(t);
  const deleting = fetch(`${d.base}/api/spec/${root}`, { method: 'DELETE', headers: { Origin: d.base } });
  await d.gate.reached;

  const res = await d.patch(`/api/spec/${child}/organize`, { collection: 'Testing' });
  assert.equal(res.status, 200);

  d.gate.release();
  await deleting;
});

test('a reparent of a spec no delete is holding is unaffected', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const other = seedSpec({ title: 'Other' });
  const kid = seedSpec({ title: 'Kid', parent: other });

  const d = await withStalledDelete(t);
  const deleting = fetch(`${d.base}/api/spec/${root}`, { method: 'DELETE', headers: { Origin: d.base } });
  await d.gate.reached;

  const res = await d.patch(`/api/spec/${kid}/organize`, { parent: null });
  assert.equal(res.status, 200, 'an unrelated tree was blocked by somebody else’s delete');
  assert.equal(readMeta(kid).parent, null);
  assert.equal(readMeta(child).parent, root);

  d.gate.release();
  await deleting;
});

test('the hold is released when the delete finishes', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B' });

  const d = await withStalledDelete(t);
  const deleting = fetch(`${d.base}/api/spec/${a}`, { method: 'DELETE', headers: { Origin: d.base } });
  await d.gate.reached;
  d.gate.release();
  await deleting;

  // A refusal that outlived its delete would be a spec nobody can reparent
  // again until the daemon restarts.
  const res = await d.patch(`/api/spec/${b}/organize`, { parent: root });
  assert.equal(res.status, 200);
  assert.equal(readMeta(b).parent, root);
});

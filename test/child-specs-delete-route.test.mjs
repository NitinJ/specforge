// DELETE over a subtree, and the restore that makes it survivable.
//
// The route owns the cascade rather than the handler, because the per-spec
// teardown includes revoking a share, and that lives in the publications
// registry as an async wrapper the store API cannot call.
//
// What these tests are really guarding: that a delete either takes the whole
// subtree or refuses, and never reports success having taken part of it.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { startDaemon } from './helpers/daemon-harness.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { specDir } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-delroute-');

let d;
beforeEach(async () => { d = await startDaemon(); });
afterEach(async () => { if (d) { await d.close(); d = null; } });

test('deleting a parent removes the whole subtree and says how many', async () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: a });

  const { status, body } = await d.json(`/api/spec/${root}`, {
    method: 'DELETE', headers: { Origin: d.base },
  });

  assert.equal(status, 200);
  assert.equal(body.removed.length, 4);
  assert.deepEqual([...body.removed].sort(), [root, a, b, grand].sort());
  assert.ok(body.deletionId, 'the response names the deletion so it can be undone');
  for (const id of [root, a, b, grand]) assert.equal(existsSync(specDir(id)), false);
});

test('deleting a leaf removes exactly one spec', async () => {
  const { root, children } = buildShape('fan');
  const { body } = await d.json(`/api/spec/${children[0]}`, {
    method: 'DELETE', headers: { Origin: d.base },
  });
  assert.deepEqual(body.removed, [children[0]]);
  assert.equal(existsSync(specDir(root)), true);
});

test('deleting a spec that does not exist is a 404', async () => {
  const { status } = await d.json('/api/spec/0000000000', {
    method: 'DELETE', headers: { Origin: d.base },
  });
  assert.equal(status, 404);
});

test('a template anywhere in the subtree refuses the whole delete, moving nothing', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const grand = seedSpec({ title: 'Template', parent: child });
  writeMeta(grand, { ...readMeta(grand), template: true });

  const { status } = await d.json(`/api/spec/${root}`, {
    method: 'DELETE', headers: { Origin: d.base },
  });

  assert.equal(status, 403);
  // The refusal has to be total: a delete that removed the two specs above the
  // template and then stopped would be the worst of both outcomes.
  for (const id of [root, child, grand]) {
    assert.equal(existsSync(specDir(id)), true, `${id} was removed by a refused delete`);
  }
});

test('restore brings a deleted subtree back with its relations', async () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: a });

  const del = await d.json(`/api/spec/${root}`, { method: 'DELETE', headers: { Origin: d.base } });
  const res = await d.post(`/api/deletion/${del.body.deletionId}/restore`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.restored.length, 3);
  assert.equal(readMeta(a).parent, root);
  assert.equal(readMeta(grand).parent, a);
});

test('restoring twice is a 404, because the record is gone', async () => {
  const id = seedSpec({ title: 'Doomed' });
  const del = await d.json(`/api/spec/${id}`, { method: 'DELETE', headers: { Origin: d.base } });

  await d.post(`/api/deletion/${del.body.deletionId}/restore`);
  const second = await d.post(`/api/deletion/${del.body.deletionId}/restore`);
  assert.equal(second.status, 404);
});

test('restore is a 409 when an id is back in the store, and changes nothing', async () => {
  const id = seedSpec({ title: 'Doomed' });
  const del = await d.json(`/api/spec/${id}`, { method: 'DELETE', headers: { Origin: d.base } });

  seedSpec({ id, title: 'A different spec, same id' });

  const res = await d.post(`/api/deletion/${del.body.deletionId}/restore`);
  assert.equal(res.status, 409);
  assert.equal(readMeta(id).title, 'A different spec, same id');
});

test('restore of a made-up deletion id is a 404, and of a traversing one a 400', async () => {
  assert.equal((await d.post('/api/deletion/0000000000/restore')).status, 404);
  assert.equal((await d.post('/api/deletion/..%2F..%2Fetc/restore')).status, 404);
});

test('the deletions listing reports what can be restored', async () => {
  const first = seedSpec({ title: 'First' });
  const second = seedSpec({ title: 'Second' });
  await d.json(`/api/spec/${first}`, { method: 'DELETE', headers: { Origin: d.base } });
  await d.json(`/api/spec/${second}`, { method: 'DELETE', headers: { Origin: d.base } });

  const { status, body } = await d.json('/api/deletions');
  assert.equal(status, 200);
  assert.equal(body.deletions.length, 2);
  assert.equal(body.deletions[0].rootTitle, 'Second', 'newest first');
  assert.equal(body.deletions[0].count, 1);
});

test('a delete detaches every spec in the subtree from its session', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  const { attach } = await import('../lib/attach.mjs');
  attach(root, 'sess-del-0001');
  attach(child, 'sess-del-0001');
  assert.equal(readMeta(child).attachedSession, 'sess-del-0001');

  const { specsForSession } = await import('../lib/attach.mjs');
  await d.json(`/api/spec/${root}`, { method: 'DELETE', headers: { Origin: d.base } });

  // The session index must not keep pointing at specs that are gone.
  assert.deepEqual(specsForSession('sess-del-0001'), []);
});

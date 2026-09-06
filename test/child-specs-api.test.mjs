// Setting and reading the relation over HTTP.
//
// Two endpoints. `PATCH /organize` gains `parent`, which makes attach, reparent
// and detach the same one-field write, and `GET /children` answers the one
// question the sidebar asks.
//
// The error contracts get as much attention as the happy path, because they are
// what other components are built on: a 409 that wrote anyway, or a 404 that
// leaked whether a spec exists, would both pass a test that only checked codes.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { startDaemon } from './helpers/daemon-harness.mjs';
import { metaPath } from '../lib/store-paths.mjs';
import { readMeta } from '../lib/meta.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-childapi-');

let d;
beforeEach(async () => { d = await startDaemon(); });
afterEach(async () => { if (d) { await d.close(); d = null; } });

// ── PATCH /organize: attach ─────────────────────────────────────────────────

test('organize attaches a spec to a parent', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child' });

  const res = await d.patch(`/api/spec/${child}/organize`, { parent: root });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).parent, root);
  assert.equal(readMeta(child).parent, root);
});

test('organize leaves the other address fields alone when only parent is sent', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', project: 'p', collection: 'c' });

  await d.patch(`/api/spec/${child}/organize`, { parent: root });
  const m = readMeta(child);
  assert.equal(m.project, 'p');
  assert.equal(m.collection, 'c');
});

test('organize sets parent and project in one call', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child' });

  await d.patch(`/api/spec/${child}/organize`, { parent: root, project: 'specforge' });
  const m = readMeta(child);
  assert.equal(m.parent, root);
  assert.equal(m.project, 'specforge');
});

// ── PATCH /organize: detach and reparent ────────────────────────────────────

test('organize detaches with an explicit null', async () => {
  const { root, children } = buildShape('fan');
  const res = await d.patch(`/api/spec/${children[0]}/organize`, { parent: null });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).parent, null);
  assert.equal(readMeta(children[0]).parent, null);
  assert.equal(readMeta(root).parent, null, 'the parent is untouched');
});

test('organize moves a spec from one parent to another', async () => {
  const a = seedSpec({ title: 'A' });
  const b = seedSpec({ title: 'B' });
  const child = seedSpec({ title: 'Child', parent: a });

  await d.patch(`/api/spec/${child}/organize`, { parent: b });
  assert.equal(readMeta(child).parent, b);
});

test('a body with no parent key does not clear the parent', async () => {
  const { root, children } = buildShape('fan');
  await d.patch(`/api/spec/${children[0]}/organize`, { collection: 'Box' });
  assert.equal(readMeta(children[0]).parent, root, 'parent was cleared by an unrelated write');
});

// ── PATCH /organize: refusals ───────────────────────────────────────────────

test('organize refuses a parent that does not exist, and writes nothing', async () => {
  const child = seedSpec({ title: 'Child' });
  const before = readFileSync(metaPath(child));

  const res = await d.patch(`/api/spec/${child}/organize`, { parent: '0000000000' });
  assert.equal(res.status, 404);
  assert.equal(readFileSync(metaPath(child)).equals(before), true);
});

test('organize refuses a parent that is not a string or null', async () => {
  const child = seedSpec({ title: 'Child' });
  for (const bad of [42, true, {}, []]) {
    const res = await d.patch(`/api/spec/${child}/organize`, { parent: bad });
    assert.equal(res.status, 400, `accepted ${JSON.stringify(bad)}`);
  }
});

test('an empty parent is refused, not treated as a detach', async () => {
  const { root, children } = buildShape('fan');
  const res = await d.patch(`/api/spec/${children[0]}/organize`, { parent: '' });

  // Falling through on falsiness would make this a silent detach reporting 200:
  // malformed input accepted, with the spec quietly moved. `null` is how a
  // caller says detach, and it is the only way.
  assert.equal(res.status, 400);
  assert.equal(readMeta(children[0]).parent, root, 'the spec was moved by a refused request');
});

test('a whitespace parent is refused too', async () => {
  const { root, children } = buildShape('fan');
  const res = await d.patch(`/api/spec/${children[0]}/organize`, { parent: '   ' });
  assert.equal(res.status, 400);
  assert.equal(readMeta(children[0]).parent, root);
});

test('organize refuses a parent id that would escape the store', async () => {
  const child = seedSpec({ title: 'Child' });
  const res = await d.patch(`/api/spec/${child}/organize`, { parent: '../../etc/passwd' });
  assert.equal(res.status, 400);
});

test('organize refuses a spec as its own parent', async () => {
  const id = seedSpec({ title: 'Self' });
  const before = readFileSync(metaPath(id));

  const res = await d.patch(`/api/spec/${id}/organize`, { parent: id });
  assert.equal(res.status, 409);
  assert.equal(readFileSync(metaPath(id)).equals(before), true);
});

test('organize refuses a cycle and names the path', async () => {
  const { ids } = buildShape('chain5');
  const before = readFileSync(metaPath(ids[0]));

  const res = await d.patch(`/api/spec/${ids[0]}/organize`, { parent: ids[4] });
  assert.equal(res.status, 409);

  const body = await res.json();
  assert.equal(body.error, 'cycle');
  assert.deepEqual(body.ancestry, ids, 'the 409 should name the chain that would close');
  assert.equal(readFileSync(metaPath(ids[0])).equals(before), true, 'a refused reparent wrote anyway');
});

test('organize on a spec that does not exist is a 404', async () => {
  const root = seedSpec({ title: 'Root' });
  const res = await d.patch('/api/spec/0000000000/organize', { parent: root });
  assert.equal(res.status, 404);
});

// ── GET /children ───────────────────────────────────────────────────────────

test('children lists one level with the fields a row needs', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Grounding', type: 'research', status: 'review', parent: root });

  const { status, body } = await d.json(`/api/spec/${root}/children`);
  assert.equal(status, 200);
  assert.equal(body.children.length, 1);

  const row = body.children[0];
  assert.equal(row.id, child);
  assert.equal(row.title, 'Grounding');
  assert.equal(row.type, 'research');
  assert.equal(row.status, 'review');
  assert.deepEqual(row.comments, { open: 0, total: 0 });
  assert.equal(row.hasChildren, false);
});

test('children reports hasChildren so a row can offer to descend', async () => {
  const { ids } = buildShape('chain5');
  const { body } = await d.json(`/api/spec/${ids[0]}/children`);
  assert.equal(body.children[0].id, ids[1]);
  assert.equal(body.children[0].hasChildren, true);
});

test('children never recurses: a chain of five returns one row', async () => {
  const { ids } = buildShape('chain5');
  const { body } = await d.json(`/api/spec/${ids[0]}/children`);
  assert.equal(body.children.length, 1);
});

test('children returns every child of a fan, in creation order', async () => {
  const root = seedSpec({ title: 'Root' });
  const ids = [1000, 2000, 3000, 4000].map((created, n) => seedSpec({
    title: `Child ${n}`, parent: root, created,
  }));

  const { body } = await d.json(`/api/spec/${root}/children`);
  assert.deepEqual(body.children.map((c) => c.id), ids);
});

test('hasChildren is answered for every row without a scan per row', async () => {
  const root = seedSpec({ title: 'Root' });
  const leaf = seedSpec({ title: 'Leaf', parent: root, created: 1000 });
  const branch = seedSpec({ title: 'Branch', parent: root, created: 2000 });
  seedSpec({ title: 'Grandchild', parent: branch });

  const { body } = await d.json(`/api/spec/${root}/children`);
  const byId = Object.fromEntries(body.children.map((c) => [c.id, c]));
  assert.equal(byId[leaf].hasChildren, false);
  assert.equal(byId[branch].hasChildren, true);
});

test('children of a leaf is an empty array, not a 404', async () => {
  const id = seedSpec({ title: 'Leaf' });
  const { status, body } = await d.json(`/api/spec/${id}/children`);
  assert.equal(status, 200);
  assert.deepEqual(body.children, []);
});

test('children of a spec that does not exist is a 404', async () => {
  const { status } = await d.json('/api/spec/0000000000/children');
  assert.equal(status, 404);
});

test('children counts open comment threads', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  // No `author`: the name "human" is reserved, and omitting it takes the
  // pre-authors default, which is what a browser that has not named itself does.
  const anchor = { block: { index: 1, tag: 'P', text: 'a claim' } };
  const posted = await d.post(`/api/spec/${child}/comments`, { body: 'a question', anchor });
  assert.equal(posted.status, 201, await posted.text());

  const { body } = await d.json(`/api/spec/${root}/children`);
  assert.deepEqual(body.children[0].comments, { open: 1, total: 1 });
});

test('children tolerates a child whose parent points at a missing spec', async () => {
  const { child } = buildShape('dangling');
  const { status, body } = await d.json(`/api/spec/${child}/children`);
  assert.equal(status, 200);
  assert.deepEqual(body.children, []);
});

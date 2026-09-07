// Children on the home page.
//
// The point of child specs is to reduce what a reviewer has to hold in their
// head, so a child must not add a row to the top-level list: it is drawn
// indented under its parent instead. The list is exactly as long as it was.
//
// The exception is the views that answer "what should I look at now". A child
// with open comments hidden behind a parent that does not match the filter is
// the one failure this feature could introduce, so Needs-you and Live render
// flat with the parent named on each child row.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { renderIndex } from '../server/index-page.mjs';
import { listSpecs, readMeta } from '../lib/meta.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-idxchild-');

const dom = () => new JSDOM(renderIndex({})).window.document;
const rows = (doc) => Array.prototype.slice.call(doc.querySelectorAll('li.row'));
const depthOf = (row) => Number(row.getAttribute('data-depth') || 0);

test('a child does not add a row to the top level', () => {
  const root = seedSpec({ title: 'Root' });
  seedSpec({ title: 'Child', parent: root });
  seedSpec({ title: 'Unrelated' });

  const doc = dom();
  const top = rows(doc).filter((r) => depthOf(r) === 0);
  assert.equal(top.length, 2, 'the top-level list grew when a child was added');
  assert.equal(rows(doc).length, 3, 'every spec still has exactly one row');
});

test('a child is drawn directly under its parent', () => {
  const root = seedSpec({ title: 'Root', created: 1000 });
  const child = seedSpec({ title: 'Child', parent: root, created: 2000 });
  seedSpec({ title: 'Later sibling', created: 3000 });

  const ordered = rows(dom()).map((r) => r.getAttribute('data-id'));
  assert.equal(ordered[ordered.indexOf(root) + 1], child, 'the child is not under its parent');
});

test('a child row is marked as one level in', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  const doc = dom();
  const byId = Object.fromEntries(rows(doc).map((r) => [r.getAttribute('data-id'), r]));
  assert.equal(depthOf(byId[root]), 0);
  assert.equal(depthOf(byId[child]), 1);
});

test('a grandchild renders under its own parent, not two levels deep', () => {
  const { ids } = buildShape('chain5');
  const doc = dom();
  const byId = Object.fromEntries(rows(doc).map((r) => [r.getAttribute('data-id'), r]));

  // The home page shows one level of indentation. Deeper is the panel's job.
  assert.equal(depthOf(byId[ids[0]]), 0);
  for (const id of ids.slice(1)) assert.equal(depthOf(byId[id]), 1);
});

test('a parent row says how many children it has', () => {
  const { root, children } = buildShape('fan');
  const doc = dom();
  const row = doc.querySelector(`li.row[data-id="${root}"]`);
  const count = row.querySelector('.kids');
  assert.ok(count, 'a parent row carries no child count');
  assert.match(count.textContent, new RegExp(String(children.length)));
});

test('a leaf row carries no child count', () => {
  const id = seedSpec({ title: 'Leaf' });
  const row = dom().querySelector(`li.row[data-id="${id}"]`);
  assert.equal(row.querySelector('.kids'), null);
});

test('a child whose parent is missing renders at top level', () => {
  const { child } = buildShape('dangling');
  const row = dom().querySelector(`li.row[data-id="${child}"]`);
  assert.equal(depthOf(row), 0, 'an orphan should not be indented under nothing');
});

test('a store with no relations renders exactly as it did before', () => {
  buildShape('flat');
  const before = renderIndex({});
  // Nothing about the tree should appear in a store that has none.
  assert.doesNotMatch(before, /data-depth="1"/);
  assert.doesNotMatch(before, /class="kids"/);
});

test('a child carries its parent id, so a flat view can name it', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const row = dom().querySelector(`li.row[data-id="${child}"]`);
  assert.equal(row.getAttribute('data-parent'), root);
});

test('a parent and child in different collections draw in the same group', () => {
  // The child inherits its parent's address at creation, but the two can be
  // moved apart afterwards. Drawing the child in its own collection puts it in a
  // section its parent is not in, where it renders as a root: the relation
  // disappears and the child looks like a spec belonging to nothing.
  //
  // An earlier version of this test checked adjacency across ALL rows and passed
  // while the child was in a separate group, because two groups of one put the
  // rows next to each other anyway. Group membership is the thing to assert.
  const root = seedSpec({ title: 'Root', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, collection: 'Testing' });

  const doc = dom();
  const group = doc.querySelector(`li.row[data-id="${root}"]`).closest('section.grp');
  const inGroup = Array.prototype.map.call(group.querySelectorAll('li.row'), (r) => r.getAttribute('data-id'));

  assert.deepEqual(inGroup, [root, child], 'the child is not drawn with its parent');
  assert.equal(group.getAttribute('data-coll'), 'Design', "the group is the parent's");
  assert.equal(depthOf(doc.querySelector(`li.row[data-id="${child}"]`)), 1);
});

test('a parent and child in different projects draw in the same project section', () => {
  const root = seedSpec({ title: 'Root', project: 'alpha' });
  const child = seedSpec({ title: 'Child', parent: root, project: 'beta' });

  const doc = dom();
  const section = doc.querySelector(`li.row[data-id="${root}"]`).closest('section.pgrp');
  const ids = Array.prototype.map.call(section.querySelectorAll('li.row'), (r) => r.getAttribute('data-id'));
  assert.deepEqual(ids, [root, child]);
  assert.equal(section.getAttribute('data-p'), 'alpha');
});

test('grouping a child under its root does not rewrite what it is filed as', () => {
  const root = seedSpec({ title: 'Root', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, collection: 'Testing' });
  renderIndex({});

  // Where a row is DRAWN is not where the spec is FILED. A render that quietly
  // refiled specs would move them for every other reader of the store too.
  assert.equal(readMeta(child).collection, 'Testing');
  assert.equal(readMeta(root).collection, 'Design');
});

test('an orphan keeps its own address', () => {
  const { child } = buildShape('dangling');
  const doc = dom();
  const row = doc.querySelector(`li.row[data-id="${child}"]`);
  assert.equal(depthOf(row), 0);
  assert.ok(row.closest('section.grp'), 'the orphan is not in a group at all');
});

test('the flat views name a child parent, and the tree views do not show it', () => {
  const root = seedSpec({ title: 'Design spec' });
  const child = seedSpec({ title: 'Testing strategy', parent: root });

  const doc = dom();
  const row = doc.querySelector(`li.row[data-id="${child}"]`);
  const under = row.querySelector('.under');

  // Rendered on every child row and shown by CSS only in the attention views,
  // where the row is out of its tree and the indent is gone.
  assert.ok(under, 'a child row does not name its parent at all');
  assert.match(under.textContent, /Design spec/);
  assert.match(renderIndex({}), /body\[data-view="attn"\] \.under/);
});

test('a spec in a cycle still gets a row', () => {
  // Unreachable by a walk from any root, so a renderer that only follows the
  // tree would silently drop all three. A spec missing from the page is worse
  // than one drawn in the wrong place, and the page is how you would notice.
  const { ids } = buildShape('cyclic');
  const drawn = rows(dom()).map((r) => r.getAttribute('data-id'));
  for (const id of ids) assert.ok(drawn.includes(id), `${id} is missing from the page`);
});

test('every spec in the store gets a row, whatever the shape', () => {
  buildShape('chain5');
  buildShape('fan');
  buildShape('dangling');
  const ids = listSpecs().map((m) => m.id).sort();
  const drawn = rows(dom()).map((r) => r.getAttribute('data-id')).sort();
  assert.deepEqual(drawn, ids);
});

test('a child drawn with its parent still carries its own address', () => {
  // Where a row is DRAWN is a presentation choice; what a row SAYS it is filed
  // as is read by the move controls, which then write it back. A child grouped
  // under its parent that reported the parent's collection would offer to move
  // it out of a collection it was never in.
  const root = seedSpec({ title: 'Root', project: 'alpha', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, project: 'beta', collection: 'Testing' });

  const row = dom().querySelector(`li.row[data-id="${child}"]`);
  assert.equal(row.getAttribute('data-c'), 'Testing');
  assert.equal(row.getAttribute('data-p'), 'beta');
});

test('a cycle member keeps its own address rather than a neighbour\u2019s', () => {
  // The walk up stops at a repeat, and the spec it stops ON is whichever member
  // came first \u2014 not the one being placed. Two members filed differently then
  // swapped addresses, which is a row in a section it was never filed in.
  const a = seedSpec({ title: 'Ring A', collection: 'Design', project: 'alpha' });
  const b = seedSpec({ title: 'Ring B', collection: 'Testing', project: 'beta' });
  seedSpec({ id: a, title: 'Ring A', parent: b, collection: 'Design', project: 'alpha' });
  seedSpec({ id: b, title: 'Ring B', parent: a, collection: 'Testing', project: 'beta' });

  const doc = dom();
  for (const id of [a, b]) {
    const row = doc.querySelector(`li.row[data-id="${id}"]`);
    assert.equal(row.getAttribute('data-c'), readMeta(id).collection || '');
    assert.equal(row.getAttribute('data-p'), readMeta(id).project || '');
  }
});

test('a refiled child is filtered by the section it is drawn in, not the one it is filed in', () => {
  const root = seedSpec({ title: 'Root', project: 'alpha', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, project: 'beta', collection: 'Testing' });

  const row = dom().querySelector(`li.row[data-id="${child}"]`);
  assert.equal(row.getAttribute('data-gp'), 'alpha', 'the filter would show it under beta');
  assert.equal(row.getAttribute('data-gc'), 'Design', 'the filter would show it under Testing');
  assert.equal(row.getAttribute('data-p'), 'beta', 'the move controls lost its own address');
  assert.equal(row.getAttribute('data-c'), 'Testing', 'the move controls lost its own address');
});

test('a root and an unrelated spec are drawn where they are filed', () => {
  const root = seedSpec({ title: 'Root', project: 'alpha', collection: 'Design' });
  const other = seedSpec({ title: 'Other', project: 'beta', collection: 'Testing' });

  const doc = dom();
  for (const [id, p, c] of [[root, 'alpha', 'Design'], [other, 'beta', 'Testing']]) {
    const row = doc.querySelector(`li.row[data-id="${id}"]`);
    assert.equal(row.getAttribute('data-gp'), p);
    assert.equal(row.getAttribute('data-gc'), c);
  }
});

test('the filters read the drawn address', () => {
  const html = renderIndex({});
  assert.match(html, /function projOk\(r\)\{ return fproj===null\|\|r\.getAttribute\('data-gp'\)===fproj; \}/);
  assert.match(html, /fcoll===null\|\|r\.getAttribute\('data-gc'\)===fcoll/);
});


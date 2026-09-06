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
import { listSpecs } from '../lib/meta.mjs';

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

test('a parent and child in different collections still draw together', () => {
  // The child inherits its parent's address at creation, but the two can be
  // moved apart afterwards. Drawing the child in its own collection would put
  // it under a parent that is not on screen.
  const root = seedSpec({ title: 'Root', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, collection: 'Testing' });

  const ordered = rows(dom()).map((r) => r.getAttribute('data-id'));
  assert.equal(ordered[ordered.indexOf(root) + 1], child);
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

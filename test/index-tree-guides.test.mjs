// The tree's guide lines, once the reader starts moving rows around.
//
// Which levels a row's line crosses is worked out from the drawn order
// (lib/spec-rows.mjs) and stamped as data-spines. That order is the server's
// first answer, not the final one: sorting reorders siblings, so a different
// child is last, and filtering hides rows anywhere in a subtree. Left at the
// server's answer, a line runs past the last visible child or stops short of
// one, and the tree on screen stops matching the tree the rows describe.
//
// The page re-derives them after every pass that can change either. These tests
// hold that, because the failure is silent: nothing errors, the list just draws
// a relation the store does not have.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-treeguide-');

const rowFor = (doc, id) => doc.querySelector(`.row[data-id="${id}"]`);
const spines = (doc, id) => rowFor(doc, id).getAttribute('data-spines');

/**
 * Root with two children, the first of which has a child of its own.
 *
 * The titles run against the stamps on purpose: newest-first draws Zebra above
 * Apple, and Title A–Z swaps them, so which child is last depends on the sort.
 */
function subtree() {
  const root = seedSpec({ title: 'Root', updated: 4000 });
  const z = seedSpec({ title: 'Zebra', parent: root, updated: 3000 });
  const z1 = seedSpec({ title: 'Zebra cub', parent: z, updated: 2000 });
  const a = seedSpec({ title: 'Apple', parent: root, updated: 1000 });
  return { root, z, z1, a };
}

test('sorting the siblings moves the end of the line with them', async (t) => {
  const { z, z1, a } = subtree();
  const { window } = loadIndex(t, {});
  const doc = window.document;

  // Newest first: Zebra, its child, then Apple. Apple is last, so the line
  // ends on it and Zebra's carries on down to it.
  assert.equal(spines(doc, z), '1');
  assert.equal(spines(doc, z1), '1',
    "the grandchild must carry its grandparent's line through the subtree");
  assert.equal(spines(doc, a), null);

  // Title A–Z puts Apple first and Zebra last, so the end of the line moves.
  const sort = doc.getElementById('fsort');
  sort.value = 'title';
  sort.onchange();
  await tick(window);

  const order = [].slice.call(doc.querySelectorAll('.row[data-id]'))
    .map((r) => r.querySelector('.title').textContent);
  assert.deepEqual(order, ['Root', 'Apple', 'Zebra', 'Zebra cub']);
  assert.equal(spines(doc, a), '1', 'Apple is not last any more');
  assert.equal(spines(doc, z), null, 'the line runs past Zebra, which is now last');
  assert.equal(spines(doc, z1), null,
    "nothing follows the grandchild, so it carries no line at all");
});

test('a filtered-out last child hands the end of the line to the one left', async (t) => {
  const { z, a } = subtree();
  const { window } = loadIndex(t, {});
  const doc = window.document;

  assert.equal(spines(doc, z), '1', 'Zebra is not last, so its line carries on');

  // Search Apple off the page. Zebra is the last child left on screen, so its
  // line has to stop on it rather than run down to a row nobody can see.
  const search = doc.getElementById('search');
  search.value = 'zebra';
  search.oninput();
  await tick(window);

  assert.equal(rowFor(doc, a).style.display, 'none', 'Apple is still on screen');
  assert.equal(spines(doc, z), null,
    'the line still runs past Zebra to a row the filter removed');
});

test('clearing the filter puts the line back', async (t) => {
  const { z, a } = subtree();
  const { window } = loadIndex(t, {});
  const doc = window.document;
  const search = doc.getElementById('search');

  search.value = 'zebra';
  search.oninput();
  await tick(window);
  search.value = '';
  search.oninput();
  await tick(window);

  assert.equal(spines(doc, z), '1', 'Zebra did not get its line back');
  assert.equal(spines(doc, a), null, 'Apple is the last child again');
});

test('the selected row keeps its guide line', async (t) => {
  // Both .row:hover and .row.picked tint the row. Written as the `background`
  // shorthand, either one drops the background image the line is drawn with,
  // so the tree breaks through whichever row the reader is pointing at or has
  // ticked for a bulk move.
  seedSpec({ title: 'Root' });
  const { window } = loadIndex(t, {});
  const html = window.document.documentElement.outerHTML;

  assert.match(html, /\.row:hover\{background-color:/, 'hover uses the shorthand');
  assert.match(html, /\.row\.picked\{background-color:/, 'selection uses the shorthand');
});

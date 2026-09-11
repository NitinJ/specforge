// Children on a shared project page.
//
// The page listed every spec in the project as its own row, newest first, so a
// reviewer met a parent's children scattered through the list and the parent
// itself wherever its timestamp put it. Nothing on a row said which spec it
// belonged to. The owner's home page draws the same project as a tree, and the
// two pages list the same specs, so they now draw the same tree.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { renderProjectPage } from '../server/project-page.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-pchild-');

const P = 'Atelier';
const TOK = 'c'.repeat(32);

const dom = () => new JSDOM(renderProjectPage(P, TOK)).window.document;
const rows = (doc) => Array.prototype.slice.call(doc.querySelectorAll('li.row[data-id]'));
const byId = (doc) => Object.fromEntries(rows(doc).map((r) => [r.getAttribute('data-id'), r]));
const depthOf = (row) => Number(row.getAttribute('data-depth') || 0);
const inP = (o) => seedSpec({ project: P, ...o });

test('a child is drawn directly under its parent, even when it is newer', () => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  inP({ title: 'Unrelated' });
  // The page sorts newest first. The child is newer than its parent, which put
  // it above the parent before the page drew a tree.
  const order = rows(dom()).map((r) => r.getAttribute('data-id'));
  assert.equal(order[order.indexOf(root) + 1], child);
});

test('a child row is one level in, and a parent row is not', () => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  const doc = dom();
  assert.equal(depthOf(byId(doc)[root]), 0);
  assert.equal(depthOf(byId(doc)[child]), 1);
  assert.ok(byId(doc)[child].classList.contains('kid'));
});

test('a parent row says how many children it has', () => {
  const root = inP({ title: 'Root' });
  inP({ title: 'A', parent: root });
  inP({ title: 'B', parent: root });
  const doc = dom();
  const count = byId(doc)[root].querySelector('.kids');
  assert.ok(count, 'the parent row carries no count');
  assert.match(count.textContent, /2/);
  assert.match(count.getAttribute('title'), /2 child specs/);
});

test('a grandchild sits under its own parent and names it', () => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Testing strategy', parent: root });
  const grand = inP({ title: 'Fixture inventory', parent: child });
  const doc = dom();
  const order = rows(doc).map((r) => r.getAttribute('data-id'));
  assert.equal(order[order.indexOf(child) + 1], grand);
  // One level of indent, so the indent alone reads it as the child's sibling.
  // The row names its parent instead.
  const row = byId(doc)[grand];
  assert.equal(depthOf(row), 1);
  assert.ok(row.classList.contains('nested'));
  assert.match(row.querySelector('.under').textContent, /Testing strategy/);
  assert.ok(!byId(doc)[child].classList.contains('nested'), 'a direct child is not nested');
});

test('a child filed in another collection is drawn with its parent', () => {
  const root = inP({ title: 'Root', collection: 'Design' });
  const child = inP({ title: 'Child', parent: root, collection: 'Testing' });
  const doc = dom();
  const section = byId(doc)[child].closest('section');
  assert.ok(section.contains(byId(doc)[root]), 'the child is not in its parent’s section');
  assert.equal(section.querySelector('.gcount').textContent, '2');
});

test('a child whose parent is outside the project is drawn at the top level', () => {
  const root = seedSpec({ title: 'Elsewhere', project: 'Other' });
  const child = inP({ title: 'Stray', parent: root });
  const doc = dom();
  assert.equal(rows(doc).length, 1);
  assert.equal(depthOf(byId(doc)[child]), 0);
});

test('a cycle still gives every spec exactly one row', () => {
  const ids = [0, 1, 2].map((n) => inP({ title: `Ring ${n}` }));
  ids.forEach((id, i) => inP({ id, title: `Ring ${i}`, parent: ids[(i + 2) % 3] }));
  const seen = rows(dom()).map((r) => r.getAttribute('data-id')).sort();
  assert.deepEqual(seen, [...ids].sort());
});

test('a project with no collections still draws the tree', () => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  const doc = dom();
  assert.equal(doc.querySelectorAll('section.grp').length, 0);
  assert.equal(depthOf(byId(doc)[child]), 1);
});

test('a child row links to its own spec under the project token', () => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  const link = byId(dom())[child].querySelector('a.title');
  assert.equal(link.getAttribute('href'), `/p/${TOK}/spec/${child}`);
});

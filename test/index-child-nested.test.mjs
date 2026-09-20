// Deep descendants on the home page.
//
// The page draws two steps of indent. A grandchild gets the second step, so it
// no longer reads as its own parent's sibling. Past that the indent stops: a
// great-grandchild sits at the grandchild's step and names its parent on the
// row instead, which is the label the flat views already show.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { renderIndex } from '../server/index-page.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-idxnest-');

const byId = (doc) => Object.fromEntries(Array.prototype.slice
  .call(doc.querySelectorAll('li.row')).map((r) => [r.getAttribute('data-id'), r]));

test('a grandchild gets a step of its own, not its parent’s', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Testing strategy', parent: root });
  const grand = seedSpec({ title: 'Fixture inventory', parent: child });
  const rows = byId(new JSDOM(renderIndex({})).window.document);
  assert.equal(rows[child].getAttribute('data-depth'), '1');
  assert.equal(rows[grand].getAttribute('data-depth'), '2');
  assert.ok(!rows[grand].classList.contains('nested'), 'the indent still says where it sits');
  assert.ok(!rows[child].classList.contains('nested'), 'a direct child is not nested');
});

test('a row past the last step is marked nested and names its parent', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Testing strategy', parent: root });
  const grand = seedSpec({ title: 'Fixture inventory', parent: child });
  const great = seedSpec({ title: 'Seed data', parent: grand });
  const rows = byId(new JSDOM(renderIndex({})).window.document);
  assert.equal(rows[great].getAttribute('data-depth'), '2');
  assert.ok(rows[great].classList.contains('nested'));
  assert.match(rows[great].querySelector('.under').textContent, /Fixture inventory/);
  assert.ok(!rows[grand].classList.contains('nested'), 'a grandchild is not nested');
});

test('the tree view shows the parent name on nested rows only', () => {
  // The rule lives in the shared list CSS, so both pages carry it.
  assert.match(renderIndex({}), /\.row\.nested \.under\{display:inline\}/);
});

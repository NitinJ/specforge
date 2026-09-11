// Grandchildren on the home page.
//
// The page draws one level of indent, so a grandchild sits at the same indent
// as its parent and reads as that parent's sibling. It names its parent on the
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

test('a grandchild row is marked nested and names its parent', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Testing strategy', parent: root });
  const grand = seedSpec({ title: 'Fixture inventory', parent: child });
  const rows = byId(new JSDOM(renderIndex({})).window.document);
  assert.ok(rows[grand].classList.contains('nested'));
  assert.match(rows[grand].querySelector('.under').textContent, /Testing strategy/);
  assert.ok(!rows[child].classList.contains('nested'), 'a direct child is not nested');
});

test('the tree view shows the parent name on nested rows only', () => {
  // The rule lives in the shared list CSS, so both pages carry it.
  assert.match(renderIndex({}), /\.row\.nested \.under\{display:inline\}/);
});

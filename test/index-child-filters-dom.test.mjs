// Filtering the home page when a child is filed away from its parent.
//
// A row carries two addresses. What the spec is FILED as, which the move
// controls read and write back, and where its row is DRAWN, which for a child
// is its root's section. The filters have to read the drawn one: a section is
// emitted under the root's address, so filtering on the child's own re-showed
// the root's foreign section around it and the heading on screen then
// contradicted the rail. The rail's counts have to agree with the filter, or a
// row shows a count and opens empty.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { writeGlobalPrefs } from '../lib/global-prefs.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-childfilter-');

const shown = (el) => el.style.display !== 'none' && !el.hidden;
const rowFor = (doc, id) => doc.querySelector(`.row[data-id="${id}"]`);
const sectionFor = (doc, p) => doc.querySelector(`section.pgrp[data-p="${p}"]`);
const collRow = (doc, c) => doc.querySelector(`.crow[data-c="${c}"]`);
const collNav = (doc, c) => doc.querySelector(`.crow[data-c="${c}"] .cnav`);

/** A parent in alpha/Design with a child filed in beta/Testing. */
function refiledChild() {
  writeGlobalPrefs({ projects: ['alpha', 'beta'] });
  const root = seedSpec({ title: 'Root', project: 'alpha', collection: 'Design' });
  const child = seedSpec({ title: 'Child', parent: root, project: 'beta', collection: 'Testing' });
  const native = seedSpec({ title: 'Native', project: 'beta', collection: 'Testing' });
  return { root, child, native };
}

test('selecting the project a child is filed in does not drag its parent’s section along', async (t) => {
  const { root, child, native } = refiledChild();
  const { window } = loadIndex(t, {});
  const doc = window.document;

  doc.querySelector('.pnav[data-p="beta"]').click();
  await tick(window);

  assert.equal(shown(sectionFor(doc, 'alpha')), false,
    'selecting beta put alpha’s section on screen');
  assert.equal(shown(rowFor(doc, native)), true);
  assert.equal(shown(rowFor(doc, child)), false,
    'the child is drawn in alpha, so beta must not show it out of its section');
  assert.equal(shown(rowFor(doc, root)), false);
});

test('a refiled child shows where it is drawn', async (t) => {
  const { root, child } = refiledChild();
  const { window } = loadIndex(t, {});
  const doc = window.document;

  doc.querySelector('.pnav[data-p="alpha"]').click();
  await tick(window);

  assert.equal(shown(rowFor(doc, root)), true);
  assert.equal(shown(rowFor(doc, child)), true, 'the child left the section it is drawn in');
});

test('a collection row’s count is what selecting it shows', async (t) => {
  const { child, native } = refiledChild();
  const { window } = loadIndex(t, {});
  const doc = window.document;

  const testing = collRow(doc, 'Testing');
  assert.ok(testing, 'the Testing rail row is missing');
  const counted = Number(testing.querySelector('.nc').textContent);

  collNav(doc, 'Testing').click();
  await tick(window);

  const visible = [].slice.call(doc.querySelectorAll('.row[data-id]')).filter(shown);
  assert.equal(visible.length, counted,
    'the rail counted rows the filter then hid');
  assert.ok(visible.some((r) => r.getAttribute('data-id') === native));
  assert.ok(!visible.some((r) => r.getAttribute('data-id') === child),
    'the child is drawn in Design, so Testing must not claim it');
});

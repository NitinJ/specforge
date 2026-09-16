// Folding the child rows under a parent, on both list pages.
//
// The child-count pill on a parent row is the toggle (server/tree-fold.mjs).
// A fold takes every spec below the parent off the page — grandchildren are
// drawn at depth 1, so the drawn tree cannot answer and data-parent is what is
// walked. The state is the reader's, per spec id, one localStorage key per page
// kind, and the default is the tree unfolded, which is what the page showed
// before a fold existed.
//
// On the home page a fold composes with the filters: a narrowed list answers a
// question that cuts across the tree, so a search hit must not stay buried
// under a parent the reader folded.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { renderIndex } from '../server/index-page.mjs';
import { renderProjectPage } from '../server/project-page.mjs';
import { treeFoldScript } from '../server/tree-fold.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-treefold-');

const INDEX_KEY = 'sf-index-folds';
const PROJECT_KEY = 'sf-project-folds';
const P = 'Atelier';
const TOK = 'c'.repeat(32);
const inP = (o) => seedSpec({ project: P, ...o });
// A row can be off the page two ways: a fold hides with the attribute, a filter
// with an inline display. The tests read both.
const off = (row) => !row || row.hidden || row.style.display === 'none';
const rowFor = (doc, id) => doc.querySelector(`li.row[data-id="${id}"]`);

// ---- the toggle, as rendered ------------------------------------------------

test('the child count on a parent row is a fold toggle, expanded by default', () => {
  const root = inP({ title: 'Root' });
  inP({ title: 'Child', parent: root });

  for (const html of [renderIndex({}), renderProjectPage(P, TOK)]) {
    const doc = new JSDOM(html).window.document;
    const pill = rowFor(doc, root).querySelector('.kids');
    assert.ok(pill, 'a parent row carries no fold toggle');
    assert.equal(pill.tagName, 'BUTTON', 'the toggle is not a button');
    assert.equal(pill.getAttribute('type'), 'button');
    assert.equal(pill.getAttribute('aria-expanded'), 'true', 'the tree starts unfolded');
    // Clicking it must not follow the title link.
    assert.equal(pill.closest('a'), null, 'the toggle sits inside the title link');
  }
});

test('a leaf row carries no toggle, and a nested parent still does', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const grand = seedSpec({ title: 'Grandchild', parent: child });

  const doc = new JSDOM(renderIndex({})).window.document;
  assert.equal(rowFor(doc, grand).querySelector('.kids'), null, 'a leaf grew a toggle');
  // The child is a parent in its own right even though it is drawn as a kid.
  const pill = rowFor(doc, child).querySelector('.kids');
  assert.ok(pill, 'a grandchild-parent carries no fold toggle');
  assert.equal(pill.getAttribute('aria-expanded'), 'true');
});

// ---- folding, on the home page ----------------------------------------------

test('a fold takes the whole subtree off the page, parent stays', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const grand = seedSpec({ title: 'Grandchild', parent: child });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  rowFor(doc, root).querySelector('.kids').click();
  await tick(window);

  assert.equal(off(rowFor(doc, root)), false, 'the toggle row folded itself away');
  assert.equal(off(rowFor(doc, child)), true, 'the child is still on the page');
  assert.equal(off(rowFor(doc, grand)), true, 'the grandchild is still on the page');
  assert.equal(rowFor(doc, root).querySelector('.kids').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(INDEX_KEY)), [root]);
});

test('a second click unfolds, and a fresh page starts unfolded', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  assert.equal([].slice.call(doc.querySelectorAll('li.row[data-id]')).filter(off).length, 0,
    'a page with nothing folded shows hidden rows');

  const pill = rowFor(doc, root).querySelector('.kids');
  pill.click();
  await tick(window);
  pill.click();
  await tick(window);

  assert.equal(off(rowFor(doc, child)), false, 'the fold did not lift');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(INDEX_KEY)), []);
});

test('a fold is remembered for the page kind, and a load applies it', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const { window } = loadIndex(t, {}, {
    beforeParse(w) { w.localStorage.setItem(INDEX_KEY, JSON.stringify([root])); },
  });
  const doc = window.document;

  assert.equal(off(rowFor(doc, child)), true, 'a load left the folded child on the page');
  assert.equal(rowFor(doc, root).querySelector('.kids').getAttribute('aria-expanded'), 'false');
});

test('a fold holds on a page opened on a project', async (t) => {
  // The page opens on the last project picked. A project keeps whole trees
  // together, so it must not suspend the folds the way a search does.
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  const { window } = loadIndex(t, { project: P });
  const doc = window.document;

  const pill = rowFor(doc, root).querySelector('.kids');
  pill.click();
  await tick(window);

  assert.equal(off(rowFor(doc, child)), true, 'the fold was undone by the project filter');
  assert.equal(pill.getAttribute('aria-expanded'), 'false');
  assert.equal(pill.title, 'Show 1 child spec');
  assert.ok(rowFor(doc, root).classList.contains('folded'), 'a folded parent is not marked');
});

test('a search hit is not buried under a folded parent', async (t) => {
  const root = seedSpec({ title: 'Design system' });
  const child = seedSpec({ title: 'Testing strategy', parent: root });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  rowFor(doc, root).querySelector('.kids').click();
  await tick(window);
  assert.equal(off(rowFor(doc, child)), true);

  const search = doc.getElementById('search');
  search.value = 'testing';
  search.dispatchEvent(new window.Event('input'));
  await tick(window);

  assert.equal(off(rowFor(doc, child)), false,
    'a row the search asks for stayed behind the fold');
  assert.equal(off(rowFor(doc, root)), true, 'the parent does not match and stays hidden');
  // And the fold takes the list back when the search is gone.
  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  await tick(window);
  assert.equal(off(rowFor(doc, child)), true);
});

// ---- folding, on the shared project page ------------------------------------

test('the shared page folds the same way, under its own key', async (t) => {
  const root = inP({ title: 'Root' });
  const child = inP({ title: 'Child', parent: root });
  const dom = new JSDOM(renderProjectPage(P, TOK), {
    runScripts: 'dangerously', url: 'http://localhost/',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;

  rowFor(doc, root).querySelector('.kids').click();
  await new Promise((r) => dom.window.setTimeout(r, 0));

  assert.equal(off(rowFor(doc, child)), true, 'the fold did nothing on the shared page');
  assert.equal(rowFor(doc, root).querySelector('.kids').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(PROJECT_KEY)), [root]);
});

// ---- the walk ---------------------------------------------------------------

test('the fold walk follows data-parent, and a cycle must not hang it', (t) => {
  const dom = new JSDOM(`<ul>
    <li class="row" data-id="p"><button class="kids" type="button" aria-expanded="true">1</button></li>
    <li class="row kid" data-id="c" data-parent="p"><button class="kids" type="button" aria-expanded="true">1</button></li>
    <li class="row kid nested" data-id="g" data-parent="c"></li>
    <li class="row" data-id="a" data-parent="b"><button class="kids" type="button" aria-expanded="true">1</button></li>
    <li class="row" data-id="b" data-parent="a"></li>
  </ul><script>${treeFoldScript('unit-test')}window.sfFoldsApply=sfFoldsApply;</script>`,
  { runScripts: 'dangerously', url: 'http://localhost/' });
  const { window } = dom;
  t.after(() => window.close());
  const row = (id) => window.document.querySelector(`li.row[data-id="${id}"]`);

  window.sfFoldsApply(['p', 'b']);
  assert.equal(row('p').hidden, false, 'the folded parent itself must stay');
  assert.equal(row('c').hidden, true);
  assert.equal(row('g').hidden, true, 'a grandchild escaped the fold');
  assert.equal(row('b').hidden, true,
    'a ring is one closed chain: a fold on any member takes the ring');
  assert.equal(row('a').hidden, true, 'the ring member above the fold must hide');
  assert.equal(row('p').querySelector('.kids').getAttribute('aria-expanded'), 'false');
  // c is not folded itself, only buried under a folded parent: its own state
  // reads expanded, and the row carrying it is hidden anyway.
  assert.equal(row('c').querySelector('.kids').getAttribute('aria-expanded'), 'true');

  window.sfFoldsApply([]);
  assert.equal([].slice.call(window.document.querySelectorAll('li.row')).filter(off).length, 0);
  assert.equal(row('p').querySelector('.kids').getAttribute('aria-expanded'), 'true');
});

// ---- the CSS composes with a fold -------------------------------------------

test('the guide line reads a fold: the elbow goes to the last visible child', () => {
  const html = renderIndex({});
  assert.match(html, /\.row\[hidden\]\{display:none\}/,
    'a fold hides nothing without an author rule');
  assert.match(html, /\.row\.kid:not\(:has\(\+ \.row\.kid:not\(\[hidden\]\)\)\)::before/,
    'the elbow still counts a hidden sibling as the last child');
});
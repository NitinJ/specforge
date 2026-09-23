// Driving the home page's project interaction in a jsdom window: selecting a
// project, what that does to the rail and the rows, and the four project
// operations (new, rename, delete, reorder) plus moving specs between projects.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { writeGlobalPrefs } from '../lib/global-prefs.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { seedProjects } from './helpers/project-store.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-projdom-');

const shown = (el) => el.style.display !== 'none' && !el.hidden;
const rowsIn = (doc) => [].slice.call(doc.querySelectorAll('.row[data-id]'));
const visibleRows = (doc) => rowsIn(doc).filter(shown);
const projNav = (doc, p) => doc.querySelector(p === null ? '.pnav[data-all]' : `.pnav[data-p="${p}"]`);
const collRow = (doc, c) => doc.querySelector(`.crow[data-c="${c}"]`);
const patches = (calls) => calls.filter((c) => c.method === 'PATCH' && /\/organize$/.test(c.url));
const prefPuts = (calls) => calls.filter((c) => c.method === 'PUT' && /\/api\/prefs$/.test(c.url));

/**
 * Open a kebab menu and return its items by label.
 *
 * The label is read from its own span rather than sliced off textContent: the
 * icons include astral-plane characters (the wastebasket is a surrogate pair),
 * so stripping "the first character" leaves half of one behind.
 */
function menuItems(window, kebab) {
  kebab.click();
  return [].slice.call(window.document.querySelectorAll('#menu .mitem'))
    .map((b) => ({ label: b.querySelector('span:last-child').textContent.trim(), el: b }));
}
function clickMenuItem(window, kebab, label) {
  const item = menuItems(window, kebab).find((i) => i.label.startsWith(label));
  assert.ok(item, `menu offers "${label}"`);
  item.el.click();
}

/** Answer the shared prompt dialog (SFUI.prompt) with a name. */
function answerPrompt(document, value) {
  const input = document.getElementById('sf-dp-input');
  assert.ok(document.getElementById('sf-dp').hasAttribute('open'), 'it asks for a name');
  input.value = value;
  document.getElementById('sf-dp-ok').click();
}

/** Select a row's checkbox the way a pointer would. */
function pick(window, id) {
  const box = window.document.querySelector(`.row[data-id="${id}"] .sel`);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// ---- selecting a project ----

test('selecting a project shows only its specs and names it in the header', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 2 }, specforge: { Engineering: 3 } });
  const { window } = loadIndex(t);
  const { document } = window;

  assert.equal(visibleRows(document).length, 5, 'All projects shows everything');

  projNav(document, 'figur').click();
  assert.equal(visibleRows(document).length, 2);
  assert.ok(visibleRows(document).every((r) => r.getAttribute('data-p') === 'figur'));
  assert.equal(document.getElementById('htitle').textContent, 'figur');
  assert.ok(document.body.classList.contains('inproj'), 'the project heading gives way to the header');
});

test('going back to All projects restores every row', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 }, '': { '': 2 } });
  const { window } = loadIndex(t);
  const { document } = window;

  projNav(document, 'figur').click();
  assert.equal(visibleRows(document).length, 1);
  projNav(document, null).click();
  assert.equal(visibleRows(document).length, 3);
  assert.equal(document.getElementById('htitle').textContent, 'All specs');
  assert.equal(document.body.classList.contains('inproj'), false);
});

test('No project is a selection of its own, not the absence of one', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 }, '': { '': 2 } });
  const { window } = loadIndex(t);
  const { document } = window;

  projNav(document, '').click();
  assert.equal(visibleRows(document).length, 2);
  assert.ok(visibleRows(document).every((r) => r.getAttribute('data-p') === ''));
  assert.equal(document.getElementById('htitle').textContent, 'No project');
});

test('the selection is persisted, so the next load opens where you left off', async (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 } });
  const { window, calls } = loadIndex(t);

  projNav(window.document, 'figur').click();
  await tick(window);
  const put = prefPuts(calls).at(-1);
  assert.ok(put, 'the selection is written');
  assert.equal(put.body.project, 'figur');

  projNav(window.document, null).click();
  await tick(window);
  assert.equal(prefPuts(calls).at(-1).body.project, null, 'All projects stores null');
});

test('a selection that arrived in the URL is persisted, so the store agrees with the screen', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 } });
  const { window, calls } = loadIndex(t, { project: 'specforge' }, { url: 'http://localhost/?project=specforge' });
  await tick(window);

  assert.equal(window.document.getElementById('htitle').textContent, 'specforge');
  const put = prefPuts(calls).at(-1);
  assert.ok(put, 'the arriving selection is written');
  assert.equal(put.body.project, 'specforge');
});

test('a stale ?project= link does not clear the selection it could not honour', async (t) => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });
  // Following a chip on a spec whose project has since been deleted: the page
  // falls back to All projects to show something, but storing that fallback
  // would wipe a selection the user still wants, and outlive the page.
  const { window, calls } = loadIndex(
    t, { project: 'deleted-elsewhere' }, { url: 'http://localhost/?project=deleted-elsewhere' },
  );
  await tick(window);

  assert.equal(window.document.getElementById('htitle').textContent, 'All specs', 'shown as All projects');
  assert.equal(prefPuts(calls).length, 0, 'and nothing is written');
});

test('?project= naming No project is honoured and stored', async (t) => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, '': { '': 1 } });
  const { window, calls } = loadIndex(t, { project: '' }, { url: 'http://localhost/?project=' });
  await tick(window);

  assert.equal(window.document.getElementById('htitle').textContent, 'No project');
  assert.equal(prefPuts(calls).at(-1).body.project, '', 'the empty selection is a real one');
});

test('a plain load does not re-write the selection it was already given', async (t) => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });
  const { window, calls } = loadIndex(t);
  await tick(window);
  assert.equal(prefPuts(calls).length, 0, 'nothing to converge, so nothing is sent');
});

test('the collections rail narrows to the selected project, with its own counts', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 3 }, specforge: { UI: 1, Engineering: 4 } });
  const { window } = loadIndex(t);
  const { document } = window;

  projNav(document, 'figur').click();
  assert.equal(shown(collRow(document, 'UI')), true);
  assert.equal(shown(collRow(document, 'Engineering')), false, 'not a filter that leads anywhere here');
  assert.equal(collRow(document, 'UI').querySelector('.nc').textContent, '3');

  projNav(document, 'specforge').click();
  assert.equal(shown(collRow(document, 'Engineering')), true);
  assert.equal(collRow(document, 'UI').querySelector('.nc').textContent, '1', "the other project's count");
});

test('search does not reach outside the selected project', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: ['Wardrobe grid'] }, specforge: { UI: ['Wardrobe audit'] } });
  const { window } = loadIndex(t);
  const { document } = window;
  const search = document.getElementById('search');

  search.value = 'wardrobe';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(visibleRows(document).length, 2, 'All projects searches the store');

  projNav(document, 'figur').click();
  assert.equal(visibleRows(document).length, 1, 'inside a project, search stays inside it');
  assert.match(visibleRows(document)[0].textContent, /Wardrobe grid/);
});

test('a view and a project narrow together rather than replacing each other', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 2 }, '': { '': 2 } });
  const { window } = loadIndex(t);
  const { document } = window;

  projNav(document, 'figur').click();
  document.querySelector('.nav[data-view="live"]').click();
  assert.equal(visibleRows(document).length, 0, 'no live specs in figur');
  assert.equal(document.querySelector('.pnav[data-p="figur"]').classList.contains('on'), true,
    'choosing a view does not drop you out of the project');
});

// ---- the two levels are visually distinguishable ----
// The fault this guards against shipped once: a project heading at 13px and a
// collection heading at 11px, both weight 650, is a level change carried by two
// pixels and a case change.
//
// Asserted through computed style rather than by matching the stylesheet text,
// so reformatting the CSS cannot break the test and flattening the hierarchy
// cannot slip past it. Only properties with literal values are checked: jsdom
// does not resolve var(), so the rule under the heading and the count pill are
// verified in a browser instead.

test('a project heading outweighs the collection headings under it', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;

  const style = (el) => window.getComputedStyle(el);
  const ph = document.querySelector('.pgrp .ph');
  const ch = document.querySelector('.grp h2');
  const phSize = parseFloat(style(ph).fontSize);
  const chSize = parseFloat(style(ch).fontSize);

  assert.ok(phSize >= chSize + 4,
    `project ${phSize}px vs collection ${chSize}px: too close to read as a level change`);
  assert.notEqual(style(ph).textTransform, style(ch).textTransform,
    'and the two are not both uppercase, which would flatten them again');
});

test('the top-of-list spacing follows the first shown project, not the first in the DOM', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: ['Wardrobe grid'] }, specforge: { Engineering: ['Markdown interop'] } });
  const { window } = loadIndex(t);
  const { document } = window;
  const lead = () => [].slice.call(document.querySelectorAll('.pgrp.lead')).map((p) => p.getAttribute('data-p'));

  assert.deepEqual(lead(), ['figur'], 'the first one to begin with');

  // Filter figur out of the page. specforge is now the first thing a reader
  // sees, so the tight top spacing has to move to it; leaving it on the hidden
  // section would drop specforge below a gap meant to separate two projects.
  const search = document.getElementById('search');
  search.value = 'markdown';
  search.dispatchEvent(new window.Event('input'));

  assert.equal(document.querySelector('.pgrp[data-p="figur"]').style.display, 'none');
  assert.deepEqual(lead(), ['specforge']);
});

test('reordering projects moves the spacing to the one that becomes first', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  const lead = () => [].slice.call(document.querySelectorAll('.pgrp.lead')).map((p) => p.getAttribute('data-p'));

  assert.deepEqual(lead(), ['figur']);

  // A reorder is a DOM move with no filter pass behind it, so the marker has to
  // be refreshed there too or it stays on whatever used to be first.
  clickMenuItem(window, document.querySelector('.prow[data-p="specforge"] .kebab'), 'Move up');
  await tick(window);

  assert.deepEqual(lead(), ['specforge']);
});

test('the same holds for the first shown collection inside a project', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  // UI seeded first on purpose: the groups come out by recency, and Product
  // then leads whether or not the two land on the same millisecond (a tie falls
  // to A–Z, which names Product first as well).
  seedProjects({ figur: { UI: ['Wardrobe grid'], Product: ['Garment model'] } });
  const { window } = loadIndex(t);
  const { document } = window;
  const lead = () => [].slice.call(document.querySelectorAll('.grp.lead')).map((g) => g.getAttribute('data-coll'));

  assert.deepEqual(lead(), ['Product']);

  const search = document.getElementById('search');
  search.value = 'wardrobe';
  search.dispatchEvent(new window.Event('input'));
  assert.deepEqual(lead(), ['UI']);
});

// ---- moving specs ----

test('a row can be moved into a project from its menu', async (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  const store = seedProjects({ '': { '': 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const row = document.querySelector(`.row[data-id="${store.ids[0]}"]`);

  clickMenuItem(window, row.querySelector('.kebab'), 'Move to project');
  const item = document.querySelector('#cpick .pitem[data-v="figur"]');
  assert.ok(item, 'the picker offers the project');
  item.click();
  await tick(window);

  const p = patches(calls);
  assert.equal(p.length, 1);
  assert.equal(p[0].body.project, 'figur');
  assert.ok(!('collection' in p[0].body), 'moving between projects leaves the collection alone');
});

test('the picker offers an empty project, which has no rows to be read off', (t) => {
  writeGlobalPrefs({ projects: ['brand-new'] });
  const store = seedProjects({ '': { '': 1 } });
  const { window } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector(`.row[data-id="${store.ids[0]}"] .kebab`), 'Move to project');
  assert.ok(document.querySelector('#cpick .pitem[data-v="brand-new"]'), 'read from the rail, not from the rows');
});

test('a selection of rows moves into a project in one action', async (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  const store = seedProjects({ '': { '': 3 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  store.ids.slice(0, 2).forEach((id) => pick(window, id));
  document.getElementById('bproj').click();
  document.querySelector('#cpick .pitem[data-v="figur"]').click();
  await tick(window);

  const p = patches(calls);
  assert.equal(p.length, 2, 'one PATCH per selected spec');
  assert.ok(p.every((c) => c.body.project === 'figur'));
});

// ---- the project operations ----

test('a new project is created, selected, and stored in the list', async (t) => {
  seedProjects({ '': { '': 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  document.getElementById('projnew').click();
  answerPrompt(document, 'figur-design-studio');
  await tick(window);

  const put = prefPuts(calls).find((c) => Array.isArray(c.body.projects));
  assert.ok(put, 'the list is written');
  assert.deepEqual(put.body.projects, ['figur-design-studio']);
});

test('renaming a project writes the list first, then moves its specs', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 2 }, specforge: { Engineering: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'figur-design-studio');
  await tick(window);
  await tick(window);

  const put = prefPuts(calls).find((c) => Array.isArray(c.body.projects));
  assert.deepEqual(put.body.projects, ['figur-design-studio', 'specforge'], 'renamed in place, keeping its rank');
  const p = patches(calls);
  assert.equal(p.length, 2, 'both of its specs move');
  assert.ok(p.every((c) => c.body.project === 'figur-design-studio'));
  assert.ok(calls.indexOf(put) < calls.indexOf(p[0]), 'the list is written before the fan-out');
});

test('renaming a project onto an existing one asks before merging them', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 2 }, specforge: { Engineering: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'specforge');
  await tick(window);

  // Nothing has moved yet: the name is taken, so this is a merge and it is asked
  // about first.
  assert.ok(document.getElementById('sf-dc').hasAttribute('open'), 'it asks');
  const body = document.getElementById('sf-dc-body').textContent;
  assert.match(body, /already exists/);
  assert.match(body, /"figur" will be gone/);
  assert.equal(patches(calls).length, 0, 'and nothing has moved while the question stands');
});

test('a name that only normalises onto an existing project still asks', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'spec forge'] });
  seedProjects({ figur: { UI: 1 }, 'spec forge': { Engineering: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  // The store collapses internal whitespace before writing, so this IS
  // "spec forge". Comparing the raw text would have merged them silently.
  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'spec   forge');
  await tick(window);

  assert.ok(document.getElementById('sf-dc').hasAttribute('open'), 'the collision is seen');
  assert.equal(patches(calls).length, 0);
});

test('a rename that normalises to the name it already has does nothing', async (t) => {
  writeGlobalPrefs({ projects: ['spec forge'] });
  seedProjects({ 'spec forge': { UI: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="spec forge"] .kebab'), 'Rename');
  answerPrompt(document, 'spec  forge');
  await tick(window);

  assert.equal(patches(calls).length, 0, 'not a rename, so not a fan-out');
  assert.equal(prefPuts(calls).filter((c) => Array.isArray(c.body.projects)).length, 0);
});

test('cancelling the merge leaves both projects exactly as they were', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 2 }, specforge: { Engineering: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'specforge');
  document.getElementById('sf-dc-cancel').click();
  await tick(window);

  assert.equal(patches(calls).length, 0, 'no spec moved');
  assert.equal(prefPuts(calls).filter((c) => Array.isArray(c.body.projects)).length, 0, 'and the list is untouched');
});

test('confirming the merge moves only the renamed project’s specs', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  const store = seedProjects({ figur: { UI: 2 }, specforge: { Engineering: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'specforge');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  await tick(window);

  const p = patches(calls);
  assert.equal(p.length, 2, "figur's two specs, not specforge's one as well");
  assert.ok(p.every((c) => c.body.project === 'specforge'));
  const moved = p.map((c) => c.url.match(/\/api\/spec\/([^/]+)\//)[1]).sort();
  assert.deepEqual(moved, store.at('figur', 'UI').slice().sort());
  assert.deepEqual(prefPuts(calls).find((c) => Array.isArray(c.body.projects)).body.projects,
    ['specforge', 'specforge'], 'the list is deduped on the way in');
});

test('deleting a project unfiles its specs and never deletes one', async (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 2 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Delete');
  assert.match(document.getElementById('sf-dc-body').textContent, /not deleted/,
    'the confirmation says what actually happens');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  await tick(window);

  assert.deepEqual(prefPuts(calls).find((c) => Array.isArray(c.body.projects)).body.projects, []);
  const p = patches(calls);
  assert.equal(p.length, 2);
  assert.ok(p.every((c) => c.body.project === ''), 'unfiled, not removed');
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'nothing is deleted');
});

test('a project moves up and down the rail, and the move is stored', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 } });
  const { window, calls, reloads } = loadIndex(t);
  const { document } = window;

  // The menu's Move down moves the row below, so the clicked row's node stays
  // put and keeps its focus — which is what "you keep your place after a move"
  // means (makeRail.move).
  const kebab = document.querySelector('.prow[data-p="figur"] .kebab');
  clickMenuItem(window, kebab, 'Move down');
  await tick(window);

  const order = [].slice.call(document.querySelectorAll('.prow[data-p]'))
    .map((r) => r.getAttribute('data-p')).filter((p) => p !== '');
  assert.deepEqual(order, ['specforge', 'figur']);
  const sections = [].slice.call(document.querySelectorAll('.pgrp')).map((p) => p.getAttribute('data-p'));
  assert.deepEqual(sections, ['specforge', 'figur'], 'and the project sections moved with it');
  assert.deepEqual(prefPuts(calls).at(-1).body.projects, ['specforge', 'figur']);
  assert.equal(reloads.n, 0, 'a move is a DOM move, not a reload');
  assert.equal(document.activeElement, kebab, 'focus is back on the button of the row you moved');
});

test('All projects and No project are not draggable and carry no menu', (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 }, '': { '': 1 } });
  const { document } = loadIndex(t).window;

  for (const sel of ['.prow[data-all]', '.prow[data-p=""]']) {
    const row = document.querySelector(sel);
    assert.equal(row.getAttribute('draggable'), null, `${sel} is not draggable`);
    assert.equal(row.querySelector('.kebab'), null, `${sel} has nothing to rename or delete`);
  }
});

// ---- collections stay scoped ----

test('renaming a collection inside a project leaves the same name elsewhere alone', async (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  const store = seedProjects({ figur: { UI: 2 }, specforge: { UI: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  projNav(document, 'figur').click();
  clickMenuItem(window, collRow(document, 'UI').querySelector('.kebab'), 'Rename');
  answerPrompt(document, 'Interface');
  await tick(window);
  await tick(window);

  const p = patches(calls);
  assert.equal(p.length, 2, "only figur's two specs");
  const moved = p.map((c) => c.url.match(/\/api\/spec\/([^/]+)\//)[1]);
  assert.deepEqual(moved.sort(), store.at('figur', 'UI').slice().sort());
  assert.ok(!moved.includes(store.first('specforge', 'UI')), "specforge's UI is a different collection");
});

test('a collection cannot be renamed or deleted from All projects', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 1, Product: 1 }, specforge: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;

  // From here "UI" names two collections with two memberships, and nothing says
  // which is meant. There is no action left that could not hit the wrong one,
  // so the menu says why instead of acting.
  const labels = menuItems(window, collRow(document, 'UI').querySelector('.kebab')).map((i) => i.label);
  assert.equal(labels.some((l) => l.startsWith('Rename')), false);
  assert.equal(labels.some((l) => l.startsWith('Delete')), false);
  assert.equal(labels.length, 1, 'one line of explanation, not an action');
  assert.match(labels[0], /several projects/);

  // And inside a project it is unambiguous again.
  projNav(document, 'figur').click();
  const inProj = menuItems(window, collRow(document, 'UI').querySelector('.kebab')).map((i) => i.label);
  assert.ok(inProj.some((l) => l.startsWith('Rename')));
  assert.ok(inProj.some((l) => l.startsWith('Delete')));
});

test('an empty project drops the Collections heading rather than heading nothing', (t) => {
  writeGlobalPrefs({ projects: ['figur', 'brand-new'] });
  seedProjects({ figur: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;

  assert.equal(document.getElementById('chead').hidden, false, 'shown while there are collections');
  projNav(document, 'brand-new').click();
  assert.equal(document.getElementById('chead').hidden, true);
  assert.equal([].slice.call(document.querySelectorAll('.crow')).filter(shown).length, 0);
});

test('a collection used by only one project can be renamed from All projects', (t) => {
  // The store this ships into uses no projects at all, so every collection sits
  // in exactly one (No project). Requiring a project selection to rename one
  // would take an action away from every existing user on upgrade.
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 }, '': { Research: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;

  const labels = menuItems(window, collRow(document, 'Research').querySelector('.kebab')).map((i) => i.label);
  assert.ok(labels.some((l) => l.startsWith('Rename')), 'unambiguous, so it is offered');
  assert.ok(labels.some((l) => l.startsWith('Delete')));
});

// ---- the rail's write machinery ----
// makeRail is the projects rail's alone now — collections come out by recency
// and have no rank to move — so its failure handling is driven here. The
// machine itself is unchanged: one write in flight, moves coalesced into the
// next, and a rollback to the last order the store is known to hold.

const railOrder = (doc) => [].slice.call(doc.querySelectorAll('.prow[data-p]'))
  .map((r) => r.getAttribute('data-p')).filter((p) => p !== '');

// A reorder has nothing else to do, so a failed write leaves the page showing an
// order the store does not hold — until a reload silently undoes it. Undo it now
// instead, and say why.
test('a reorder that fails to save puts the rail back', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 } });
  const { window, reloads } = loadIndex(t);
  const { document } = window;
  window.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  assert.deepEqual(railOrder(document), ['Alpha', 'Beta']);
  clickMenuItem(window, document.querySelector('.prow[data-p="Beta"] .kebab'), 'Move up');
  await tick(window);
  assert.deepEqual(railOrder(document), ['Alpha', 'Beta'], 'the move is undone');
  const sections = [].slice.call(document.querySelectorAll('.pgrp')).map((p) => p.getAttribute('data-p'));
  assert.deepEqual(sections, ['Alpha', 'Beta'], 'and so is the list');
  const toast = document.querySelector('.sfui-snack');
  assert.match(toast.textContent, /order could not be saved/);
  assert.equal(window.sessionStorage.getItem('sf-index-msg'), null,
    'nothing reloads here, so the message is not carried into the next load');
  assert.equal(reloads.n, 0);
});

// Two moves in quick succession used to be two writes in flight. If the first
// failed and the second landed, the first's rollback restored its own stale
// snapshot over an order that had actually saved. One write at a time, and the
// move made during it coalesced into a single write after it.
test('a second move during a save does not race it', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta', 'Gamma'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 }, Gamma: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  const sent = [];
  let release;
  const held = new Promise((r) => { release = r; });
  window.fetch = (url, init) => {
    sent.push(JSON.parse(init.body).projects);
    return held.then(() => ({ ok: true, json: () => Promise.resolve({}) }));
  };
  const up = (name) => clickMenuItem(window, document.querySelector(`.prow[data-p="${name}"] .kebab`), 'Move up');

  up('Gamma'); // Alpha, Gamma, Beta — the write for this is in flight
  up('Gamma'); // Gamma, Alpha, Beta — must not start a second write yet
  assert.equal(sent.length, 1, 'only one write in flight');
  assert.deepEqual(sent[0], ['Alpha', 'Gamma', 'Beta']);

  release();
  await tick(window);
  await tick(window);
  assert.equal(sent.length, 2, 'the move made during the write follows it');
  assert.deepEqual(sent[1], ['Gamma', 'Alpha', 'Beta'], 'and sends the rail as it now stands');
  assert.deepEqual(railOrder(document), ['Gamma', 'Alpha', 'Beta'], 'which is what is on screen');
});

// The rollback must not run before the coalesced write has taken the rail: it
// would wipe the newer move off the screen and then store the wipe.
test('a move made during a failing write survives it', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta', 'Gamma'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 }, Gamma: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  const sent = [];
  let settle;
  const held = new Promise((r) => { settle = r; });
  let first = true;
  window.fetch = (url, init) => {
    sent.push(JSON.parse(init.body).projects);
    if (first) { first = false; return held.then(() => ({ ok: false, status: 500, json: () => Promise.resolve({}) })); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  const up = (name) => clickMenuItem(window, document.querySelector(`.prow[data-p="${name}"] .kebab`), 'Move up');

  up('Gamma'); // in flight, and it will fail
  up('Gamma'); // made during it — this is the newer intent
  settle();
  await tick(window);
  await tick(window);
  assert.deepEqual(railOrder(document), ['Gamma', 'Alpha', 'Beta'], 'the newer move is still on screen');
  assert.deepEqual(sent[sent.length - 1], ['Gamma', 'Alpha', 'Beta'], 'and is what got stored');
  assert.equal(document.querySelector('.sfui-snack'), null, 'a failure the retry recovered from is not reported');
});

test('a rollback goes to the last order that saved, not to where the move began', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  let ok = true;
  window.fetch = () => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve({}) });
  const up = (name) => clickMenuItem(window, document.querySelector(`.prow[data-p="${name}"] .kebab`), 'Move up');

  up('Beta');
  await tick(window);
  assert.deepEqual(railOrder(document), ['Beta', 'Alpha'], 'saved');

  ok = false;
  up('Alpha');
  await tick(window);
  assert.deepEqual(railOrder(document), ['Beta', 'Alpha'], 'back to the saved order, not the original');
});

test('an order that fails to save says so, and the rename it carried still happens', async (t) => {
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  window.fetch = (url) => (/\/api\/prefs$/.test(url)
    ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  clickMenuItem(window, document.querySelector('.prow[data-p="figur"] .kebab'), 'Rename');
  answerPrompt(document, 'Release');
  await tick(window);
  const toast = document.querySelector('.sfui-snack');
  assert.ok(toast, 'a failed order write is not swallowed');
  assert.match(toast.textContent, /order could not be saved/);
});

// Dragging is the primary way to reorder; the menu's Move up / Move down is the
// same thing for a keyboard. jsdom has no drag machinery, but the handlers only
// read target/clientY, so a MouseEvent under the drag event's name drives them.
function drag(window, row, onto, { after = false } = {}) {
  const fire = (name, el, extra) => el.dispatchEvent(
    new window.MouseEvent(name, { bubbles: true, cancelable: true, ...extra }),
  );
  fire('dragstart', row);
  // getBoundingClientRect is all zeros in jsdom, so clientY > 0 reads as the
  // bottom half of the row and clientY <= 0 as the top half.
  fire('dragover', onto.querySelector('.pnav'), { clientY: after ? 1 : 0 });
  fire('dragend', window.document.querySelector('.prow.dragging') || row);
}

test('dragging a project past another reorders the rail and the list, and saves', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta', 'Gamma'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 }, Gamma: { UI: 1 } });
  const { window, calls, reloads } = loadIndex(t);
  const { document } = window;
  const row = (n) => document.querySelector(`.prow[data-p="${n}"]`);
  assert.equal(row('Alpha').getAttribute('draggable'), 'true');
  assert.equal(row('').getAttribute('draggable'), null, 'No project is not draggable');

  drag(window, row('Gamma'), row('Alpha'));
  await tick(window);
  assert.deepEqual(railOrder(document), ['Gamma', 'Alpha', 'Beta'], 'dropped above Alpha');
  const sections = [].slice.call(document.querySelectorAll('.pgrp')).map((p) => p.getAttribute('data-p'));
  assert.deepEqual(sections, ['Gamma', 'Alpha', 'Beta'], 'the list follows');
  assert.deepEqual(prefPuts(calls).at(-1).body.projects, ['Gamma', 'Alpha', 'Beta']);
  assert.equal(reloads.n, 0);

  drag(window, row('Gamma'), row('Beta'), { after: true });
  await tick(window);
  assert.deepEqual(railOrder(document), ['Alpha', 'Beta', 'Gamma'], 'and below when dropped low');
});

test('a drag leaves the rail clean, and one that changes nothing writes nothing', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const alpha = document.querySelector('.prow[data-p="Alpha"]');
  alpha.dispatchEvent(new window.MouseEvent('dragstart', { bubbles: true }));
  assert.ok(alpha.classList.contains('dragging'), 'the row being carried is marked');
  assert.ok(document.getElementById('projs').classList.contains('rearranging'));
  alpha.dispatchEvent(new window.MouseEvent('dragend', { bubbles: true }));
  assert.ok(!alpha.classList.contains('dragging'), 'and unmarked when it lands');
  assert.ok(!document.getElementById('projs').classList.contains('rearranging'));
  await tick(window);
  assert.equal(prefPuts(calls).length, 0, 'a drag that ends where it started is not a change');
});

test('No project cannot be dragged past, and stays last', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha'] });
  seedProjects({ Alpha: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  drag(window, document.querySelector('.prow[data-p="Alpha"]'), document.querySelector('.prow[data-p=""]'), { after: true });
  await tick(window);
  const rows = [].slice.call(document.querySelectorAll('.prow[data-p]')).map((r) => r.getAttribute('data-p'));
  assert.deepEqual(rows, ['Alpha', ''], 'nothing moved past it');
});

test('a drag that fails to save puts the rail back', async (t) => {
  writeGlobalPrefs({ projects: ['Alpha', 'Beta'] });
  seedProjects({ Alpha: { UI: 1 }, Beta: { UI: 1 } });
  const { window } = loadIndex(t);
  const { document } = window;
  window.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  drag(window, document.querySelector('.prow[data-p="Beta"]'), document.querySelector('.prow[data-p="Alpha"]'));
  await tick(window);
  assert.deepEqual(railOrder(document), ['Alpha', 'Beta'], 'undone');
  assert.match(document.querySelector('.sfui-snack').textContent, /order could not be saved/);
});

// Tests for the revamped home/index page: server-rendered structure + theme from
// the store-wide pref, the GET/PUT /api/prefs endpoint, and the page's inline
// theme-toggle + search behavior driven in a jsdom DOM.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { specDir } from '../lib/store-paths.mjs';
import { mutateComments, createThread } from '../lib/store-comments.mjs';
import { attach, claimWorker, STALE_MS } from '../lib/attach.mjs';
import { writeGlobalPrefs } from '../lib/global-prefs.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

const setCollection = (id, c) => { const m = readMeta(id); m.collection = c; writeMeta(id, m); };
const setTags = (id, tags) => { const m = readMeta(id); m.tags = tags; writeMeta(id, m); };

let home;
let prevHome;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-index-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('renderIndex shows a search box, theme toggle and a row per spec', () => {
  createSpec({ title: 'Alpha spec', html: '<h1>A</h1>' });
  createSpec({ title: 'Beta spec', html: '<h1>B</h1>' });
  const html = renderIndex();
  assert.match(html, /id="search"/);
  assert.match(html, /id="theme"/);
  assert.match(html, /Alpha spec/);
  assert.match(html, /Beta spec/);
  assert.match(html, /class="badge s s-draft"/); // status badge
});

test('renderIndex defaults to light and honors the stored dark theme', () => {
  assert.match(renderIndex(), /<html lang="en" data-theme="light"/);
  writeGlobalPrefs({ theme: 'dark' });
  assert.match(renderIndex(), /<html lang="en" data-theme="dark"/);
});

test('empty store renders the empty state, no groups', () => {
  const html = renderIndex();
  assert.match(html, /No specs yet/);
  assert.doesNotMatch(html, /class="grp"/);
});

test('specs render grouped under collection headers (+ Uncollected)', () => {
  const a = createSpec({ title: 'Auth design', html: '<h1>A</h1>' });
  createSpec({ title: 'Loose spec', html: '<h1>L</h1>' });
  setCollection(a, 'Launch');
  const html = renderIndex();
  assert.match(html, /<h2>Launch <span class="gcount">1<\/span>/);
  assert.match(html, /<h2>Uncollected <span class="gcount">1<\/span>/);
});

test('rows show live / disconnected from worker and heartbeat state', () => {
  const live = createSpec({ title: 'Live one', html: '<h1>L</h1>' });
  attach(live, 'sess-live');
  claimWorker('sess-live'); // live worker + fresh heartbeat → live
  const dead = createSpec({ title: 'Dead one', html: '<h1>D</h1>' });
  attach(dead, 'sess-dead');
  const m = readMeta(dead); m.heartbeat = Date.now() - STALE_MS - 1000; writeMeta(dead, m); // stale → disconnected
  createSpec({ title: 'Free one', html: '<h1>F</h1>' }); // unattached → neither
  const html = renderIndex();
  assert.match(html, /class="live"[^>]*><span class="dot"><\/span> live/);
  assert.match(html, /class="off"[^>]*>○ disconnected/);
  // exactly one live + one disconnected (the free spec shows neither)
  assert.equal((html.match(/ live</g) || []).length, 1);
  assert.equal((html.match(/○ disconnected/g) || []).length, 1);
  // live/disconnected rows carry the edge accent; the free row does not
  assert.equal((html.match(/row edge-live/g) || []).length, 1);
  assert.equal((html.match(/row edge-off/g) || []).length, 1);
});

test('a tagged spec renders chips + one actions menu', () => {
  const id = createSpec({ title: 'Tagged', html: '<h1>T</h1>' });
  setTags(id, ['api', 'auth']);
  const html = renderIndex();
  assert.match(html, /<span class="chip" data-tag="api">api/);
  assert.match(html, /<span class="chip" data-tag="auth">auth/);
  assert.match(html, /class="kebab"/, 'every action is behind one menu button');
});

// The three affordances this replaced were hover-only glyphs — a ✎, a ▣ and a 🗑
// at opacity:0 until the pointer was over the row, which is no affordance at all
// on a touch screen and hard to find on any screen.
test('a row carries no hover-only glyph controls any more', () => {
  createSpec({ title: 'X', html: '<h1>X</h1>' });
  const html = renderIndex();
  for (const gone of ['class="rename"', 'class="collbtn"', 'class="del"', 'class="coll"', 'class="rename-in"']) {
    assert.ok(!html.includes(gone), `${gone} is gone`);
  }
  assert.ok(!html.includes('<datalist'), 'and with them the type-the-exact-name datalist');
});

test('GET/PUT /api/prefs persists the index theme', async () => {
  const server = createDaemon();
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const g0 = await (await fetch(`${base}/api/prefs`)).json();
    assert.deepEqual(g0.prefs, {});
    const put = await fetch(`${base}/api/prefs`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'dark' }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual((await put.json()).prefs, { theme: 'dark' });
    const g1 = await (await fetch(`${base}/api/prefs`)).json();
    assert.deepEqual(g1.prefs, { theme: 'dark' });
  } finally {
    server.close();
  }
});

// ---- inline page behavior in jsdom ----
// loadIndex and tick live in test/helpers/index-dom.mjs, shared with the project
// suite.

test('theme toggle flips data-theme and PUTs the new theme', (t) => {
  createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  document.getElementById('theme').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok(calls.some((c) => c.method === 'PUT' && /\/api\/prefs$/.test(c.url) && c.body.theme === 'dark'), 'PUT theme=dark');
});

test('search filters rows + groups and updates the count', (t) => {
  createSpec({ title: 'Alpha report', html: '<h1>A</h1>' });
  createSpec({ title: 'Beta design', html: '<h1>B</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  const search = document.getElementById('search');
  search.value = 'alpha';
  search.dispatchEvent(new window.Event('input'));
  const visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.equal(visible.length, 1, 'only the matching row stays visible');
  assert.match(document.getElementById('count').textContent, /1 of 2/);
});

test('search updates per-group counts to the visible rows', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  setCollection(a, 'Launch'); // Alpha under "Launch", Beta under "Uncollected"
  const { window } = loadIndex(t);
  const { document } = window;
  const search = document.getElementById('search');
  search.value = 'alpha';
  search.dispatchEvent(new window.Event('input'));
  const launch = [].slice.call(document.querySelectorAll('.grp')).find((g) => /Launch/.test(g.querySelector('h2').textContent));
  assert.match(launch.querySelector('.gcount').textContent, /^1$/, 'Launch group shows 1 match');
  assert.equal(launch.style.display !== 'none', true, 'matching group stays visible');
});

function enter(window, el) { el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }

/** The menu item whose label contains `label`, from whichever menu is open. */
function item(document, label) {
  return [].slice.call(document.querySelectorAll('#menu .mitem'))
    .find((b) => b.textContent.indexOf(label) !== -1);
}
/** Menu labels without their leading icon span. */
const labels = (document) => [].slice.call(document.querySelectorAll('#menu .mitem'))
  .map((b) => b.lastChild.textContent);
/** Open a row's actions menu and click one of its items. */
function act(document, row, label) {
  row.querySelector('.kebab').click();
  const it = item(document, label);
  assert.ok(it, `menu offers "${label}"`);
  it.click();
}

test('the row menu offers exactly rename, all three moves, contribute, and delete', (t) => {
  createSpec({ title: 'X', html: '<h1>X</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  const menu = document.getElementById('menu');
  assert.equal(menu.hidden, true, 'nothing is open until asked for');
  document.querySelector('.row[data-id] .kebab').click();
  assert.equal(menu.hidden, false, 'the menu opens under the button');
  // A spec's address has two halves and either can be set on its own, so there
  // are two move items rather than one that asks which you meant. Moving it
  // under another spec is a third: that is the parent relation, which decides
  // where the row is drawn and what a delete takes, not where the spec is filed.
  // Adding it to a shared project is different again: the first three file it on
  // this machine, this one publishes it onto someone else's.
  //
  // No 'Detach from parent' here: this spec is a root, and the row is drawn only
  // on a spec that has a parent. index-reparent-dom.test.mjs covers both cases.
  assert.deepEqual(labels(document), [
    'Rename…', 'Move to collection…', 'Move to project…', 'Move under spec…',
    'Add to a shared project…', 'Delete spec…',
  ]);
  assert.equal(document.querySelector('.row .kebab').getAttribute('aria-expanded'), 'true');
});

test('an open menu closes on Escape, on a click elsewhere, and when another opens', (t) => {
  createSpec({ title: 'A', html: '<h1>A</h1>' });
  createSpec({ title: 'B', html: '<h1>B</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  const menu = document.getElementById('menu');
  const [ka, kb] = [].slice.call(document.querySelectorAll('.row .kebab'));

  ka.click();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true, 'Escape closes it');
  assert.equal(ka.getAttribute('aria-expanded'), 'false');

  ka.click();
  document.getElementById('search').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, true, 'a click outside closes it');

  ka.click();
  kb.click();
  assert.equal(menu.hidden, false, 'the other row opens its own');
  assert.equal(ka.getAttribute('aria-expanded'), 'false', 'and the first is no longer marked open');
});

test('rename opens a dialog prefilled with the current name and POSTs /rename', async (t) => {
  createSpec({ title: 'Before', html: '<h1>Before</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  act(document, document.querySelector('.row[data-id]'), 'Rename');
  const dlg = document.getElementById('sf-dp');
  assert.ok(dlg.hasAttribute('open'), 'a real dialog, not an inline input swap');
  const input = document.getElementById('sf-dp-input');
  assert.equal(input.value, 'Before', 'prefilled, so a rename is an edit not a retype');
  input.value = 'After';
  document.getElementById('sf-dp-ok').click();
  await tick(window);
  const c = calls.find((x) => /\/rename$/.test(x.url));
  assert.ok(c && c.method === 'POST' && c.body.title === 'After', 'POST /rename {title:After}');
  assert.equal(document.querySelector('.title').textContent, 'After', 'title updated in place');
  assert.match(document.querySelector('.row[data-id]').getAttribute('data-k'), /after/, 'search key refreshed');
  assert.ok(!dlg.hasAttribute('open'), 'and the dialog closes');
});

test('Escape while a dialog is open does not clear the selection behind it', (t) => {
  const a = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  pick(window, a);
  act(document, document.querySelector(`.row[data-id="${a}"]`), 'Rename');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector(`.row[data-id="${a}"] .sel`).checked, true, 'the selection survives');
});

test('Cancel in the rename dialog changes nothing', async (t) => {
  createSpec({ title: 'Before', html: '<h1>Before</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  act(document, document.querySelector('.row[data-id]'), 'Rename');
  document.getElementById('sf-dp-input').value = 'After';
  document.getElementById('sf-dp-cancel').click();
  await tick(window);
  assert.equal(calls.filter((x) => /\/rename$/.test(x.url)).length, 0, 'nothing sent');
  assert.equal(document.querySelector('.title').textContent, 'Before');
});

test('adding a tag PATCHes /organize and shows a chip', async (t) => {
  createSpec({ title: 'X', html: '<h1>X</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  document.querySelector('.addtag').click();
  const input = document.querySelector('.addtag-in');
  input.value = 'urgent';
  enter(window, input);
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.ok(c && c.method === 'PATCH' && c.body.tags.indexOf('urgent') !== -1, 'PATCH /organize with the new tag');
  const chip = document.querySelector('.chip[data-tag="urgent"]');
  assert.ok(chip, 'chip rendered');
  assert.equal(chip.querySelector('.x').getAttribute('aria-label'), 'Remove tag', 'dynamic chip × is labelled');
  assert.match(document.querySelector('.row[data-id]').getAttribute('data-k'), /urgent/, 'search key includes the new tag');
});

test('removing a tag PATCHes /organize without it and drops the chip', async (t) => {
  const id = createSpec({ title: 'X', html: '<h1>X</h1>' });
  setTags(id, ['keep', 'drop']);
  const { window, calls } = loadIndex(t);
  const { document } = window;
  document.querySelector('.chip[data-tag="drop"] .x').click();
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.deepEqual(c.body.tags, ['keep'], 'PATCH /organize tags without the removed one');
  assert.equal(document.querySelector('.chip[data-tag="drop"]'), null, 'chip removed');
});

const setStatusMeta = (id, s) => { const m = readMeta(id); m.status = s; writeMeta(id, m); };

test('status chips filter rows; clicking the active chip resets to All', (t) => {
  const a = createSpec({ title: 'Agreed', html: '<h1>A</h1>' });
  createSpec({ title: 'Drafting', html: '<h1>B</h1>' });
  setStatusMeta(a, 'approved');
  const { window } = loadIndex(t);
  const { document } = window;
  const chip = [].slice.call(document.querySelectorAll('.fchip')).find((c) => c.getAttribute('data-f') === 'approved');
  chip.click();
  let visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.equal(visible.length, 1, 'only the approved spec shows');
  assert.match(document.getElementById('count').textContent, /1 of 2/);
  chip.click(); // toggle off → All
  visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.equal(visible.length, 2, 'clicking the active chip resets the filter');
});

test('the type select filters rows and combines with search', (t) => {
  createSpec({ title: 'Alpha research', html: '<h1>A</h1>', type: 'research' });
  createSpec({ title: 'Alpha design', html: '<h1>B</h1>', type: 'design' });
  const { window } = loadIndex(t);
  const { document } = window;
  const ftype = document.getElementById('ftype');
  ftype.value = 'research';
  ftype.dispatchEvent(new window.Event('change', { bubbles: true }));
  const visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.equal(visible.length, 1, 'only the research spec shows');
  assert.equal(visible[0].getAttribute('data-t'), 'research');
});

test('sort by title reorders rows within a group', (t) => {
  createSpec({ title: 'Zulu', html: '<h1>Z</h1>' });
  createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  const fsort = document.getElementById('fsort');
  fsort.value = 'title';
  fsort.dispatchEvent(new window.Event('change', { bubbles: true }));
  const titles = [].slice.call(document.querySelectorAll('.row .title')).map((a) => a.textContent);
  assert.deepEqual(titles, ['Alpha', 'Zulu'], 'rows reordered A–Z');
});

test('"/" focuses the search input', (t) => {
  createSpec({ title: 'A', html: '<h1>A</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  assert.equal(document.activeElement, document.getElementById('search'), 'search focused via /');
});

test('templates are not on the home page at all, and never were rows', async (t) => {
  // They moved to /settings (spec 094abd0b9d, P7): at the foot of this page they
  // sat below every spec, which is where a thing is hardest to find. The strip
  // and its show-only-when-unfiltered rule went with them; what stays true here
  // is that a template is not a row and does not count.
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  createSpec({ title: 'Working spec', html: '<h1>W</h1>' });
  ensureTemplates();
  const { window } = loadIndex(t);
  const { document } = window;
  assert.equal(document.querySelectorAll('.tcard').length, 0, 'no template cards here');
  assert.equal(document.querySelector('.tpls'), null, 'and no strip to hide');
  assert.equal(document.querySelectorAll(`.row[data-id="${templateId('design')}"]`).length, 0, 'no template row');
  assert.match(document.getElementById('count').textContent, /1 spec/, 'count excludes templates');
});

// ---- move to a collection (the picker) ----

/** Open a row's collection picker and return its items. */
function pickerFor(document, row) {
  act(document, row, 'Move to collection');
  const pick = document.getElementById('cpick');
  assert.equal(pick.hidden, false, 'the picker opens');
  return pick;
}
const items = (pick) => [].slice.call(pick.querySelectorAll('.pitem'))
  .filter((b) => b.style.display !== 'none');

// The whole point: every collection that exists is on the list, so moving a spec
// into one is picking, never spelling. The old control was a text input whose
// datalist most browsers only reveal on a caret keypress — miss the spelling by a
// character and you silently created a second collection beside the one you meant.
test('the picker lists every collection with its count and marks the current one', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  const c = createSpec({ title: 'Gamma', html: '<h1>G</h1>' });
  setCollection(a, 'Launch');
  setCollection(b, 'Launch');
  setCollection(c, 'Platform work');
  const { window } = loadIndex(t);
  const { document } = window;
  const pick = pickerFor(document, document.querySelector(`.row[data-id="${a}"]`));
  const labels = items(pick).map((b2) => b2.getAttribute('data-v'));
  assert.deepEqual(labels, ['Launch', 'Platform work', ''], 'both collections, then Uncollected');
  assert.match(items(pick)[0].textContent, /2/, 'with its member count');
  assert.ok(items(pick)[0].classList.contains('on'), "the spec's current collection is marked");
  assert.ok(!items(pick)[1].classList.contains('on'));
});

test('picking a collection PATCHes /organize with that exact name', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  setCollection(b, 'Platform work');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const pick = pickerFor(document, document.querySelector(`.row[data-id="${a}"]`));
  items(pick).find((x) => x.getAttribute('data-v') === 'Platform work').click();
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.ok(c && c.method === 'PATCH' && c.body.collection === 'Platform work', 'exact name, no typing');
  assert.ok(new RegExp(`/api/spec/${a}/organize`).test(c.url), 'on the row it was opened from');
});

test('the filter narrows the list, and offers to create only what does not exist', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  setCollection(b, 'Platform work');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const pick = pickerFor(document, document.querySelector(`.row[data-id="${a}"]`));
  const filter = document.getElementById('pfilter');

  filter.value = 'plat';
  filter.dispatchEvent(new window.Event('input'));
  assert.deepEqual(items(pick).map((x) => x.getAttribute('data-v')), ['Platform work'], 'narrowed to the match');
  const create = pick.querySelector('.pnew');
  assert.equal(create.hidden, false, 'and offers the new name it does not have');
  assert.match(create.textContent, /Create "plat"/);

  filter.value = 'Platform work';
  filter.dispatchEvent(new window.Event('input'));
  assert.equal(pick.querySelector('.pnew').hidden, true, 'an exact match is not offered as a new collection');

  filter.value = 'Backlog';
  filter.dispatchEvent(new window.Event('input'));
  pick.querySelector('.pnew').click();
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.ok(c && c.body.collection === 'Backlog', 'creating one is one click, not a second dialog');
});

test('the picker takes a spec out of every collection', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  setCollection(a, 'Launch');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const pick = pickerFor(document, document.querySelector(`.row[data-id="${a}"]`));
  const none = items(pick).find((x) => x.getAttribute('data-v') === '');
  assert.match(none.textContent, /Uncollected/);
  none.click();
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.ok(c && c.body.collection === '', 'ungrouped');
});

// ---- delete a spec (dialog confirm) ----
test('delete asks in a dialog that names the spec, and Cancel aborts', async (t) => {
  const a = createSpec({ title: 'Keep', html: '<h1>K</h1>' });
  const del = createSpec({ title: 'Zap', html: '<h1>Z</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  act(document, document.querySelector(`.row[data-id="${del}"]`), 'Delete spec');
  const dlg = document.getElementById('sf-dc');
  assert.ok(dlg.hasAttribute('open'), 'a confirm dialog, not a hover overlay');
  assert.match(document.getElementById('sf-dc-body').textContent, /Zap/, 'it names what it will delete');
  document.getElementById('sf-dc-cancel').click();
  assert.ok(!dlg.hasAttribute('open'), 'Cancel closes it');
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'nothing deleted on cancel');
  assert.ok(document.querySelector(`.row[data-id="${del}"]`), 'the row is still present');
  assert.ok(document.querySelector(`.row[data-id="${a}"]`), 'the other row untouched');
});

test('confirming a delete DELETEs the spec, removes the row, and updates the count', async (t) => {
  createSpec({ title: 'Keep', html: '<h1>K</h1>' });
  const del = createSpec({ title: 'Zap', html: '<h1>Z</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  assert.match(document.getElementById('count').textContent, /2 specs/);
  act(document, document.querySelector(`.row[data-id="${del}"]`), 'Delete spec');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  const c = calls.find((x) => x.method === 'DELETE');
  assert.ok(c && new RegExp(`/api/spec/${del}$`).test(c.url), 'DELETE /api/spec/:id fired');
  assert.equal(document.querySelector(`.row[data-id="${del}"]`), null, 'the row is removed from the DOM');
  assert.match(document.getElementById('count').textContent, /1 spec/, 'the total count drops');
});

test('a failed delete (non-2xx) keeps the row and closes the dialog', async (t) => {
  const del = createSpec({ title: 'Guarded', html: '<h1>G</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  window.fetch = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'nope' }) });
  act(document, document.querySelector(`.row[data-id="${del}"]`), 'Delete spec');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  assert.ok(document.querySelector(`.row[data-id="${del}"]`), 'the row survives a rejected delete');
  assert.ok(!document.getElementById('sf-dc').hasAttribute('open'), 'the dialog is dismissed');
});

test('template cards have no actions menu', async (t) => {
  const { ensureTemplates } = await import('../lib/store-templates.mjs');
  createSpec({ title: 'Real', html: '<h1>R</h1>' });
  ensureTemplates();
  const { window } = loadIndex(t);
  const { document } = window;
  assert.equal(document.querySelector('.tcard .kebab'), null, 'no actions on template cards');
  assert.equal(document.querySelectorAll('.row .kebab').length, 1, 'only the real spec row has them');
});

// ---- at-a-glance signals: comments and shares, per row ----

const anchor = { block: { index: 1, tag: 'P', text: 'a block' } };
async function comment(id, body, author = 'nitin') {
  const { mutateComments, createThread } = await import('../lib/store-comments.mjs');
  let tid;
  mutateComments(id, (st) => { tid = createThread(st, { anchor, body, author }).id; });
  return tid;
}

test('a spec with comments for the agent shows the review signal; a quiet one does not', async (t) => {
  const busy = createSpec({ title: 'Busy', html: '<h1>B</h1>' });
  createSpec({ title: 'Quiet', html: '<h1>Q</h1>' });
  await comment(busy, '@agent widen this');
  const { window } = loadIndex(t);
  const { document } = window;
  const row = document.querySelector(`.row[data-id="${busy}"]`);
  assert.equal(row.getAttribute('data-rv'), 'needs');
  assert.equal(row.querySelector('.rv.rv-needs .rvn').textContent, '1', 'the count of unsent comments');
  const quiet = [].slice.call(document.querySelectorAll('.row[data-id]')).find((r) => r !== row);
  assert.equal(quiet.getAttribute('data-rv'), 'clear');
  assert.equal(quiet.querySelector('.rv'), null, 'a clear spec carries no comment marker');
});

test('discussion is marked apart from work waiting on you', async (t) => {
  const id = createSpec({ title: 'Chatty', html: '<h1>C</h1>' });
  await comment(id, 'why 40 bits?', 'lavee');
  const { window } = loadIndex(t);
  const row = window.document.querySelector(`.row[data-id="${id}"]`);
  assert.equal(row.getAttribute('data-rv'), 'discussion');
  assert.ok(row.querySelector('.rv.rv-discussion'), 'discussion has its own colour, not the "needs you" one');
});

test('the Needs you view filters to specs with unsent or answered comments', async (t) => {
  const needs = createSpec({ title: 'Needs', html: '<h1>N</h1>' });
  const chat = createSpec({ title: 'Chat', html: '<h1>C</h1>' });
  createSpec({ title: 'Quiet', html: '<h1>Q</h1>' });
  await comment(needs, '@agent do this');
  await comment(chat, 'just talking', 'lavee');
  const { window } = loadIndex(t);
  const { document } = window;
  assert.match(document.querySelector('.nav[data-view="attn"]').textContent, /1$/, 'the rail counts one');
  document.querySelector('.nav[data-view="attn"]').click();
  const visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.deepEqual(visible.map((r) => r.getAttribute('data-id')), [needs], 'only the spec waiting on you');
  assert.match(document.getElementById('count').textContent, /1 of 3/);
  assert.equal(document.getElementById('htitle').textContent, 'Needs you', 'the header names the view');
});

test('a live share shows a link on the row; a dead one shows nothing', (t) => {
  const up = createSpec({ title: 'Up', html: '<h1>U</h1>' });
  const down = createSpec({ title: 'Down', html: '<h1>D</h1>' });
  // What the publications registry hands back: one origin, one token per spec.
  const shareInfo = (id) => ({
    url: `https://one-origin.trycloudflare.com/s/${id.repeat(4).slice(0, 32)}`,
    live: id === up,
  });
  const { window } = loadIndex(t, { shareInfo });
  const { document } = window;
  const pub = document.querySelector(`.row[data-id="${up}"] .pub`);
  assert.ok(pub, 'the reachable share is marked');
  assert.match(pub.getAttribute('href'), /^https:\/\/one-origin\.trycloudflare\.com\/s\/[0-9a-f]{32}$/,
    'the marker opens the composed public link');
  assert.equal(document.querySelector(`.row[data-id="${down}"] .pub`), null, 'an unreachable share is not advertised');
  assert.match(document.querySelector('.nav[data-view="shared"]').textContent, /1$/, 'the rail counts only what answers');
});

// ---- collections rail ----

test('the rail lists every collection with its count and filters on click', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  createSpec({ title: 'Loose', html: '<h1>L</h1>' });
  setCollection(a, 'Launch');
  setCollection(b, 'Launch');
  const { window } = loadIndex(t);
  const { document } = window;
  const launch = document.querySelector('.cnav[data-c="Launch"]');
  assert.match(launch.textContent, /Launch2$/, 'name + member count');
  assert.ok(document.querySelector('.cnav[data-c=""]'), 'Uncollected is listed too');
  launch.click();
  const visible = [].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none');
  assert.deepEqual(visible.map((r) => r.getAttribute('data-id')).sort(), [a, b].sort());
  assert.equal(document.getElementById('htitle').textContent, 'Launch');
  launch.click(); // toggling the active collection clears the filter
  assert.equal([].slice.call(document.querySelectorAll('.row[data-id]')).filter((r) => r.style.display !== 'none').length, 3);
});

// A collection in the rail gets the same menu a row does, from the same markup —
// so the answer to "how do I rename this?" is the same wherever you are looking.
// It is a real button in the layout, not a ✎ that appears on hover and vanishes
// below 900px, which is what it replaced.
test('a named collection carries an actions menu; Uncollected does not', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  createSpec({ title: 'Loose', html: '<h1>L</h1>' });
  setCollection(a, 'Launch');
  const { window } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  const kebab = crow.querySelector('.kebab');
  assert.ok(kebab, 'the rail row has the menu button');
  assert.match(kebab.getAttribute('aria-label'), /Launch/, 'and says which collection it acts on');
  assert.equal(document.querySelector('.crow[data-c=""] .kebab'), null, 'Uncollected is not a collection to rename');
  kebab.click();
  assert.deepEqual(labels(document), ['Rename…', 'Delete collection…']);
});


// ---- collection order ----
// Collections come out by recency (lib/collections.mjs): the most recently
// active member's newest stamp — created, updated, or the newest comment on it
// — leads, ties fall to A–Z, and Uncollected is always last. There is no
// arrangement by hand and no rank to move.

const crowOrder = (html) => (html.match(/<div class="crow" data-c="([^"]*)"/g) || [])
  .map((s) => s.split('"')[3]);

/** Pin a spec's created/updated stamps: writeMeta bumps `updated` to now. */
function stamp(id, at) {
  writeFileSync(join(specDir(id), 'meta.json'),
    JSON.stringify({ ...readMeta(id), created: at, updated: at }));
}

test('collections read by recency, then A–Z, with Uncollected last', () => {
  const a = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'B', html: '<h1>B</h1>' });
  const loose = createSpec({ title: 'Loose', html: '<h1>L</h1>' });
  setCollection(a, 'Alpha');
  setCollection(b, 'Beta');
  stamp(a, 1000); stamp(b, 1000); stamp(loose, 1000);
  assert.deepEqual(crowOrder(renderIndex()), ['Alpha', 'Beta', ''],
    'tied: alphabetical by name, Uncollected last');
  stamp(b, 2000);
  assert.deepEqual(crowOrder(renderIndex()), ['Beta', 'Alpha', ''],
    'the collection touched most recently leads');
});

test('a fresh comment lifts the commented spec’s collection', () => {
  const a = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'B', html: '<h1>B</h1>' });
  setCollection(a, 'Alpha');
  setCollection(b, 'Beta');
  stamp(a, 1000); stamp(b, 2000);
  assert.deepEqual(crowOrder(renderIndex()), ['Beta', 'Alpha']);
  mutateComments(a, (store) => createThread(store, {
    anchor: { block: { text: 'A' } },
    body: 'please tighten this',
  }));
  assert.deepEqual(crowOrder(renderIndex()), ['Alpha', 'Beta'],
    'a thread that moved is the collection being alive');
});

// role="menu" is a promise of arrow keys; a menu that only takes a mouse should
// not have claimed to be one.
test('the menu takes arrow keys, and hands focus back to the button that opened it', (t) => {
  const a = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'B', html: '<h1>B</h1>' });
  setCollection(a, 'Alpha');
  setCollection(b, 'Beta');
  const { window } = loadIndex(t);
  const { document } = window;
  const menu = document.getElementById('menu');
  const kebab = document.querySelector('.crow[data-c="Alpha"] .kebab');
  const key = (k) => menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));

  kebab.click();
  const all = [].slice.call(menu.querySelectorAll('.mitem'));
  assert.equal(document.activeElement, all[0], 'opens on the first item');
  key('ArrowDown');
  assert.equal(document.activeElement, all[1]);
  key('ArrowUp');
  assert.equal(document.activeElement, all[0]);
  key('ArrowUp');
  assert.equal(document.activeElement, all[all.length - 1], 'wraps to the end');
  key('Home');
  assert.equal(document.activeElement, all[0]);
  key('End');
  assert.equal(document.activeElement, all[all.length - 1]);
  kebab.click(); // the same button closes it again
});

test('the stored layout is validated, and a spec page is never told about it', async () => {
  // Projects are the only order left to store; collections order themselves by
  // recency and have no rank. A collectionOrder in an older ui.json is dropped.
  writeGlobalPrefs({ theme: 'dark', projects: ['  Keep  ', '', 'Keep', 42, 'Other'], collectionOrder: ['Keep'] });
  const { readGlobalPrefs } = await import('../lib/global-prefs.mjs');
  assert.deepEqual(readGlobalPrefs().projects, ['Keep', 'Other'],
    'trimmed, deduped, non-strings dropped');
  assert.equal(readGlobalPrefs().collectionOrder, undefined);

  // The review layer is served to published readers too, so it takes theme and
  // font by name rather than spreading whatever ui.json happens to hold.
  const { injectReviewLayer } = await import('../server/inject.mjs');
  const id = createSpec({ title: 'S', html: '<h1>S</h1>' });
  const out = injectReviewLayer('<html><head></head><body><h1>S</h1></body></html>', { specId: id });
  assert.match(out, /"theme":"dark"/, 'the theme still reaches the page');
  assert.ok(!out.includes('collectionOrder'), 'the collection names do not');
});

test('renaming a collection re-files every member spec', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  createSpec({ title: 'Loose', html: '<h1>L</h1>' });
  setCollection(a, 'Launch');
  setCollection(b, 'Launch');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.kebab').click();
  item(document, 'Rename').click();
  const input = document.getElementById('sf-dp-input');
  assert.equal(input.value, 'Launch', 'prefilled with the name being changed');
  input.value = 'GA';
  document.getElementById('sf-dp-ok').click();
  await tick(window);
  const moves = calls.filter((c) => /\/organize$/.test(c.url));
  assert.equal(moves.length, 2, 'one PATCH per member, none for the uncollected spec');
  assert.deepEqual(moves.map((c) => c.body.collection), ['GA', 'GA']);
  assert.ok(moves.every((c) => new RegExp(`/api/spec/(${a}|${b})/organize`).test(c.url)));
});

test('deleting a collection asks first, says what happens, then ungroups its specs', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  setCollection(a, 'Launch');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.kebab').click();
  item(document, 'Delete collection').click();
  const body = document.getElementById('sf-dc-body').textContent;
  assert.match(body, /Launch/, 'names the collection');
  assert.match(body, /Its 1 spec is not deleted/, 'how many specs it holds, and that they survive');
  assert.match(body, /uncollected/i, 'and where they end up');
  document.getElementById('sf-dc-cancel').click();
  assert.equal(calls.filter((c) => /\/organize$/.test(c.url)).length, 0, 'Cancel leaves the specs alone');
  crow.querySelector('.kebab').click();
  item(document, 'Delete collection').click();
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  const moves = calls.filter((c) => /\/organize$/.test(c.url));
  assert.equal(moves.length, 1);
  assert.equal(moves[0].body.collection, '', 'the spec is ungrouped, not deleted');
});

// ---- bulk selection ----

function pick(window, id) {
  const box = window.document.querySelector(`.row[data-id="${id}"] .sel`);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('selecting rows opens a bulk bar that moves them into one collection', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  createSpec({ title: 'Untouched', html: '<h1>U</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  assert.equal(document.getElementById('bulk').hidden, true, 'hidden until something is selected');
  pick(window, a);
  pick(window, b);
  assert.equal(document.getElementById('bulk').hidden, false);
  assert.equal(document.getElementById('bn').textContent, '2 selected');
  // The same picker the row menu opens — one way to choose a collection, not two.
  document.getElementById('bmove').click();
  const picker = document.getElementById('cpick');
  assert.equal(picker.hidden, false);
  const filter = document.getElementById('pfilter');
  filter.value = 'Launch';
  filter.dispatchEvent(new window.Event('input'));
  picker.querySelector('.pnew').click();
  await tick(window);
  const moves = calls.filter((c) => /\/organize$/.test(c.url));
  assert.equal(moves.length, 2, 'one PATCH per selected spec');
  assert.deepEqual(moves.map((c) => c.body.collection), ['Launch', 'Launch']);
});

// fetch resolves for a 403 as readily as a 200, so a bare Promise.all over the
// fan-out would report a half-renamed collection as a finished one.
test('a collection move that only partly succeeds says so', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  setCollection(a, 'Launch');
  setCollection(b, 'Launch');
  const { window, reloads } = loadIndex(t);
  const { document } = window;
  let nth = 0;
  window.fetch = (url) => {
    // Only the fan-out is made to fail — the prefs PUT that drops the collection
    // from the stored order rides along on the same channel.
    if (!/\/organize$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    nth += 1;
    return Promise.resolve({ ok: nth > 1, status: nth > 1 ? 200 : 500, json: () => Promise.resolve({}) });
  };
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.kebab').click();
  item(document, 'Delete collection').click();
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  const toast = document.querySelector('.sfui-snack');
  assert.ok(toast, 'the failure is surfaced, not swallowed');
  assert.match(toast.textContent, /1 of 2 specs moved/);
  assert.match(toast.textContent, /still in "Launch"/, 'it names where the stragglers are');
  assert.match(window.sessionStorage.getItem('sf-index-msg'), /1 of 2/, 'and survives the reload');
  assert.equal(reloads.n, 1, 'the page still reloads, so it shows the true state');
});

test('a collection move that fully succeeds says nothing', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  setCollection(a, 'Launch');
  const { window } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.kebab').click();
  item(document, 'Delete collection').click();
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  assert.equal(document.querySelector('.sfui-snack'), null);
  assert.equal(window.sessionStorage.getItem('sf-index-msg'), null);
});

test('Cancel drops the selection without touching anything', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  pick(window, a);
  document.getElementById('bcancel').click();
  assert.equal(document.getElementById('bulk').hidden, true);
  assert.equal(document.querySelector(`.row[data-id="${a}"] .sel`).checked, false);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

// The restore-on-load half is not asserted here: each JSDOM instance gets its
// own storage area, so a second load cannot see the first one's write.
test('collapsing a group folds it away and records the choice', (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  setCollection(a, 'Launch');
  const { window } = loadIndex(t);
  const grp = window.document.querySelector('.grp[data-coll="Launch"]');
  grp.querySelector('h2').click();
  assert.ok(grp.classList.contains('collapsed'));
  assert.deepEqual(JSON.parse(window.localStorage.getItem('sf-index-collapsed')), ['Launch']);
  grp.querySelector('h2').click();
  assert.ok(!grp.classList.contains('collapsed'), 'clicking again reopens it');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('sf-index-collapsed')), [], 'and forgets it');
});

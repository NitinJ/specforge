// Tests for the revamped home/index page: server-rendered structure + theme from
// the store-wide pref, the GET/PUT /api/prefs endpoint, and the page's inline
// theme-toggle + search behavior driven in a jsdom DOM.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM, VirtualConsole } from 'jsdom';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { attach, STALE_MS } from '../lib/attach.mjs';
import { writeGlobalPrefs } from '../lib/global-prefs.mjs';

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
  // The collection name is offered in the datalist for reassignment autocomplete.
  assert.match(html, /<datalist id="collections"><option value="Launch">/);
});

test('rows show live / disconnected from the owning session heartbeat', () => {
  const live = createSpec({ title: 'Live one', html: '<h1>L</h1>' });
  attach(live, 'sess-live'); // fresh heartbeat → live
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

test('a tagged spec renders chips + the rename and collection controls', () => {
  const id = createSpec({ title: 'Tagged', html: '<h1>T</h1>' });
  setTags(id, ['api', 'auth']);
  const html = renderIndex();
  assert.match(html, /<span class="chip" data-tag="api">api/);
  assert.match(html, /<span class="chip" data-tag="auth">auth/);
  assert.match(html, /class="rename"/);
  assert.match(html, /class="coll"/);
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
function loadIndex(t, opts) {
  // location.reload is unforgeable in jsdom — it cannot be stubbed — but calling
  // it raises a jsdomError, so that is how a reload is counted. Anything else on
  // that channel is a real page error and is re-raised rather than swallowed.
  const reloads = { n: 0 };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (/navigation to another Document/i.test(e.message)) reloads.n += 1;
    else throw e;
  });
  const dom = new JSDOM(renderIndex(opts), { runScripts: 'dangerously', url: 'http://localhost/', virtualConsole });
  const { window } = dom;
  t.after(() => window.close());
  const calls = [];
  window.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    // Echo the patch back so the client's DOM updates (rename → d.title, tags → d.tags).
    return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({ ok: true }, body || {})) });
  };
  return { window, calls, reloads };
}

const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

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

test('inline rename POSTs /rename and updates the title in place', async (t) => {
  createSpec({ title: 'Before', html: '<h1>Before</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  document.querySelector('.rename').click();
  const input = document.querySelector('.rename-in');
  assert.equal(input.hidden, false, 'rename input revealed');
  input.value = 'After';
  enter(window, input);
  await tick(window);
  const c = calls.find((x) => /\/rename$/.test(x.url));
  assert.ok(c && c.method === 'POST' && c.body.title === 'After', 'POST /rename {title:After}');
  assert.equal(document.querySelector('.title').textContent, 'After', 'title updated in place');
  assert.match(document.querySelector('.row[data-id]').getAttribute('data-k'), /after/, 'search key refreshed after rename');
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

test('template specs render as a bottom strip, excluded from rows and filters', async (t) => {
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  createSpec({ title: 'Working spec', html: '<h1>W</h1>' });
  ensureTemplates();
  const { window } = loadIndex(t);
  const { document } = window;
  // One card per spec type, badge included. Counted off SPEC_TYPES rather than a
  // literal, so adding a type (deck) does not fail a test about the strip.
  const { SPEC_TYPES } = await import('../lib/meta.mjs');
  const n = SPEC_TYPES.length;
  assert.equal(document.querySelectorAll('.tcard').length, n, `${n} template cards`);
  assert.ok(document.querySelector(`.tcard[data-id="${templateId('design')}"]`), 'design template card');
  assert.equal(document.querySelectorAll('.tcard .badge.tpl').length, n, 'template badge on each card');
  // templates are not filterable rows
  assert.equal(document.querySelectorAll(`.row[data-id="${templateId('design')}"]`).length, 0, 'no template row');
  assert.match(document.getElementById('count').textContent, /1 spec/, 'count excludes templates');
  // and they step aside under a filter rather than posing as results
  const search = document.getElementById('search');
  search.value = 'nothing matches this';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelector('.tpls').style.display, 'none', 'strip hidden while filtering');
  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelector('.tpls').style.display, '', 'strip back when the filter clears');
});

test('changing the collection input PATCHes /organize', async (t) => {
  createSpec({ title: 'X', html: '<h1>X</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const coll = document.querySelector('.coll');
  coll.value = 'Backlog';
  coll.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(window);
  const c = calls.find((x) => /\/organize$/.test(x.url));
  assert.ok(c && c.method === 'PATCH' && c.body.collection === 'Backlog', 'PATCH /organize {collection:Backlog}');
});

// ---- delete a spec (two-step confirm) ----
test('delete needs confirmation: the trash button reveals a confirm, Cancel aborts', async (t) => {
  const a = createSpec({ title: 'Keep', html: '<h1>K</h1>' });
  const del = createSpec({ title: 'Zap', html: '<h1>Z</h1>' });
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const row = document.querySelector(`.row[data-id="${del}"]`);
  row.querySelector('.del').click();
  assert.ok(row.classList.contains('confirming'), 'the row enters a confirming state');
  assert.equal(row.querySelector('.delconfirm').hidden, false, 'the confirm strip is shown');
  // Cancel: no request, row stays, confirm hidden.
  row.querySelector('.dcno').click();
  assert.ok(!row.classList.contains('confirming'), 'Cancel exits the confirm');
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
  const row = document.querySelector(`.row[data-id="${del}"]`);
  row.querySelector('.del').click();
  row.querySelector('.dcyes').click();
  await tick(window);
  const c = calls.find((x) => x.method === 'DELETE');
  assert.ok(c && new RegExp(`/api/spec/${del}$`).test(c.url), 'DELETE /api/spec/:id fired');
  assert.equal(document.querySelector(`.row[data-id="${del}"]`), null, 'the row is removed from the DOM');
  assert.match(document.getElementById('count').textContent, /1 spec/, 'the total count drops');
});

test('a failed delete (non-2xx) keeps the row and backs out of the confirm', async (t) => {
  const del = createSpec({ title: 'Guarded', html: '<h1>G</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  window.fetch = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'nope' }) });
  const row = document.querySelector(`.row[data-id="${del}"]`);
  row.querySelector('.del').click();
  row.querySelector('.dcyes').click();
  await tick(window);
  assert.ok(document.querySelector(`.row[data-id="${del}"]`), 'the row survives a rejected delete');
  assert.ok(!row.classList.contains('confirming'), 'the confirm is dismissed');
});

test('template cards have no delete affordance', async (t) => {
  const { ensureTemplates } = await import('../lib/store-templates.mjs');
  createSpec({ title: 'Real', html: '<h1>R</h1>' });
  ensureTemplates();
  const { window } = loadIndex(t);
  const { document } = window;
  assert.equal(document.querySelector('.tcard .del'), null, 'no delete button on template cards');
  assert.equal(document.querySelectorAll('.row .del').length, 1, 'only the real spec row has delete');
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

test('renaming a collection re-files every member spec', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const b = createSpec({ title: 'Beta', html: '<h1>B</h1>' });
  createSpec({ title: 'Loose', html: '<h1>L</h1>' });
  setCollection(a, 'Launch');
  setCollection(b, 'Launch');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.cedit').click();
  const input = crow.querySelector('.cin');
  assert.equal(input.hidden, false, 'the rename input is revealed');
  input.value = 'GA';
  enter(window, input);
  await tick(window);
  const moves = calls.filter((c) => /\/organize$/.test(c.url));
  assert.equal(moves.length, 2, 'one PATCH per member, none for the uncollected spec');
  assert.deepEqual(moves.map((c) => c.body.collection), ['GA', 'GA']);
  assert.ok(moves.every((c) => new RegExp(`/api/spec/(${a}|${b})/organize`).test(c.url)));
});

test('deleting a collection asks first, then ungroups its specs', async (t) => {
  const a = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  setCollection(a, 'Launch');
  const { window, calls } = loadIndex(t);
  const { document } = window;
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.cdel').click();
  assert.equal(crow.querySelector('.cconfirm').hidden, false, 'a confirm appears before anything moves');
  crow.querySelector('.cno').click();
  assert.equal(calls.filter((c) => /\/organize$/.test(c.url)).length, 0, 'No leaves the specs alone');
  crow.querySelector('.cdel').click();
  crow.querySelector('.cyes').click();
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
  const bcoll = document.getElementById('bcoll');
  bcoll.value = 'Launch';
  enter(window, bcoll);
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
  window.fetch = () => {
    nth += 1;
    return Promise.resolve({ ok: nth > 1, status: nth > 1 ? 200 : 500, json: () => Promise.resolve({}) });
  };
  const crow = document.querySelector('.crow[data-c="Launch"]');
  crow.querySelector('.cdel').click();
  crow.querySelector('.cyes').click();
  await tick(window);
  const toast = document.querySelector('.toast');
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
  crow.querySelector('.cdel').click();
  crow.querySelector('.cyes').click();
  await tick(window);
  assert.equal(document.querySelector('.toast'), null);
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

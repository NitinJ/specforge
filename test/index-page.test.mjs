// Tests for the revamped home/index page: server-rendered structure + theme from
// the store-wide pref, the GET/PUT /api/prefs endpoint, and the page's inline
// theme-toggle + search behavior driven in a jsdom DOM.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { writeGlobalPrefs } from '../lib/global-prefs.mjs';

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

test('empty store renders the empty state, no table', () => {
  const html = renderIndex();
  assert.match(html, /No specs yet/);
  assert.doesNotMatch(html, /<tbody id="rows">/);
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
function loadIndex(t) {
  const dom = new JSDOM(renderIndex(), { runScripts: 'dangerously', url: 'http://localhost/' });
  const { window } = dom;
  t.after(() => window.close());
  const puts = [];
  window.fetch = (url, init) => {
    if (init && init.method === 'PUT') puts.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  return { window, puts };
}

test('theme toggle flips data-theme and PUTs the new theme', (t) => {
  createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  const { window, puts } = loadIndex(t);
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  document.getElementById('theme').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok(puts.some((p) => /\/api\/prefs$/.test(p.url) && p.body.theme === 'dark'), 'PUT theme=dark');
});

test('search filters rows and updates the count', (t) => {
  createSpec({ title: 'Alpha report', html: '<h1>A</h1>' });
  createSpec({ title: 'Beta design', html: '<h1>B</h1>' });
  const { window } = loadIndex(t);
  const { document } = window;
  const search = document.getElementById('search');
  search.value = 'alpha';
  search.dispatchEvent(new window.Event('input'));
  const visible = [].slice.call(document.querySelectorAll('#rows tr')).filter((r) => r.style.display !== 'none');
  assert.equal(visible.length, 1, 'only the matching row stays visible');
  assert.match(document.getElementById('count').textContent, /1 of 2/);
});

// HTTP tests for the per-spec UI prefs endpoint (GET/PUT /api/spec/:id/prefs):
// empty default, persistence + merge across requests, validation, and 404s.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dprefs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  specId = createSpec({ title: 'A', html: '<h1>A</h1>' });
  server = createDaemon();
  const port = await listen(server);
  base = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  server.close();
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const put = (path, body) => fetch(base + path, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * The config the review layer boots from, parsed out of the served HTML.
 * It is one JSON object, so parse it rather than matching its punctuation.
 */
function injectedConfig(html) {
  const m = html.match(/window\.SPECFORGE = (\{.*?\});/);
  return m ? JSON.parse(m[1]) : null;
}

test('GET prefs returns {} before anything is stored', async () => {
  const r = await fetch(`${base}/api/spec/${specId}/prefs`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).prefs, {});
});

test('PUT persists per-spec prefs; a later GET returns them (theme/font dropped)', async () => {
  const w = await put(`/api/spec/${specId}/prefs`, { theme: 'light', width: 1200 });
  assert.equal(w.status, 200);
  // theme is store-wide now → dropped from the per-spec store.
  assert.deepEqual((await w.json()).prefs, { width: 1200 });

  const g = await fetch(`${base}/api/spec/${specId}/prefs`);
  assert.deepEqual((await g.json()).prefs, { width: 1200 });
});

test('PUT merges a partial patch and drops invalid values', async () => {
  await put(`/api/spec/${specId}/prefs`, { width: 1000, filter: 'all' });
  const r = await put(`/api/spec/${specId}/prefs`, { filter: 'bogus', fit: true });
  assert.deepEqual((await r.json()).prefs, { width: 1000, filter: 'all', fit: true });
});

test('theme + font are store-wide via /api/prefs and reach every served spec', async () => {
  const other = createSpec({ title: 'B', html: '<h1>B</h1>' });
  const g = await put('/api/prefs', { theme: 'dracula', font: 'lora' });
  assert.equal(g.status, 200);
  assert.deepEqual((await g.json()).prefs, { theme: 'dracula', font: 'lora' });
  // Both specs' served HTML embed the store-wide theme/font.
  for (const sid of [specId, other]) {
    const html = await (await fetch(`${base}/spec/${sid}`)).text();
    const cfg = injectedConfig(html);
    assert.ok(cfg, `config embedded for ${sid}`);
    assert.equal(cfg.prefs.theme, 'dracula');
    assert.equal(cfg.prefs.font, 'lora');
  }
});

test('the project list and the selection round-trip through /api/prefs', async () => {
  const r = await put('/api/prefs', { projects: ['figur', 'specforge'], project: 'figur' });
  assert.equal(r.status, 200);
  const { prefs } = await r.json();
  assert.deepEqual(prefs.projects, ['figur', 'specforge']);
  assert.equal(prefs.project, 'figur');

  // A later PUT of one key must not drop the other, since the rail writes the
  // selection far more often than it rewrites the list.
  await put('/api/prefs', { project: '' });
  const after = await (await fetch(`${base}/api/prefs`)).json();
  assert.deepEqual(after.prefs.projects, ['figur', 'specforge'], 'list survives a selection-only write');
  assert.equal(after.prefs.project, '', 'No project is a selection, not an absence');
});

test('a published spec is never handed the project list or the selection', async () => {
  await put('/api/prefs', { projects: ['figur'], project: 'figur' });
  const html = await (await fetch(`${base}/spec/${specId}`)).text();
  const { prefs } = injectedConfig(html);
  assert.equal('projects' in prefs, false, 'spec pages take prefs by name, never the whole object');
  assert.equal('project' in prefs, false);
});

test('the served spec merges store-wide theme/font with per-spec width', async () => {
  await put('/api/prefs', { theme: 'nord' });
  await put(`/api/spec/${specId}/prefs`, { width: 1300 });
  const html = await (await fetch(`${base}/spec/${specId}`)).text();
  const { prefs } = injectedConfig(html);
  assert.equal(prefs.theme, 'nord', 'store-wide theme');
  assert.equal(prefs.width, 1300, 'per-spec width');
});

test('PUT prefs 404s for an unknown spec', async () => {
  const r = await put('/api/spec/deadbeef00/prefs', { theme: 'light' });
  assert.equal(r.status, 404);
});

test('GET prefs 404s for an unknown spec', async () => {
  const r = await fetch(`${base}/api/spec/deadbeef00/prefs`);
  assert.equal(r.status, 404);
});

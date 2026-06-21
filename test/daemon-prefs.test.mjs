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

test('GET prefs returns {} before anything is stored', async () => {
  const r = await fetch(`${base}/api/spec/${specId}/prefs`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).prefs, {});
});

test('PUT persists prefs; a later GET returns them', async () => {
  const w = await put(`/api/spec/${specId}/prefs`, { theme: 'light', width: 1200 });
  assert.equal(w.status, 200);
  assert.deepEqual((await w.json()).prefs, { theme: 'light', width: 1200 });

  const g = await fetch(`${base}/api/spec/${specId}/prefs`);
  assert.deepEqual((await g.json()).prefs, { theme: 'light', width: 1200 });
});

test('PUT merges a partial patch and drops invalid values', async () => {
  await put(`/api/spec/${specId}/prefs`, { theme: 'dark', width: 1000 });
  const r = await put(`/api/spec/${specId}/prefs`, { theme: 'light', filter: 'bogus' });
  assert.deepEqual((await r.json()).prefs, { theme: 'light', width: 1000 });
});

test('PUT prefs 404s for an unknown spec', async () => {
  const r = await put('/api/spec/deadbeef00/prefs', { theme: 'light' });
  assert.equal(r.status, 404);
});

test('GET prefs 404s for an unknown spec', async () => {
  const r = await fetch(`${base}/api/spec/deadbeef00/prefs`);
  assert.equal(r.status, 404);
});

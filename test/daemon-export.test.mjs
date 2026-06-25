// HTTP tests for the Google-Docs export endpoint (POST /api/spec/:id/export) and
// the export state surfaced on GET /meta. The route only queues a request when a
// live session is attached (it's the session that runs the MCP export).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { attach } from '../lib/attach.mjs';
import { finishExport } from '../lib/store-export.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dexport-'));
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

const post = (path) => fetch(base + path, { method: 'POST' });

test('POST export 409s when no session is attached (nothing can run it)', async () => {
  const r = await post(`/api/spec/${specId}/export`);
  assert.equal(r.status, 409);
});

test('POST export queues a request when a session is attached; /meta reflects it', async () => {
  attach(specId, 'sess-1');
  const r = await post(`/api/spec/${specId}/export`);
  assert.equal(r.status, 202);
  assert.equal((await r.json()).export.state, 'requested');

  const m = await (await fetch(`${base}/api/spec/${specId}/meta`)).json();
  assert.equal(m.export.state, 'requested');
});

test('/meta surfaces the finished Doc link', async () => {
  attach(specId, 'sess-1');
  await post(`/api/spec/${specId}/export`);
  finishExport(specId, { url: 'https://docs.google.com/document/d/xyz/edit' });
  const m = await (await fetch(`${base}/api/spec/${specId}/meta`)).json();
  assert.equal(m.export.state, 'done');
  assert.equal(m.export.url, 'https://docs.google.com/document/d/xyz/edit');
});

test('a second export while one is in progress 409s (no double run)', async () => {
  attach(specId, 'sess-1');
  assert.equal((await post(`/api/spec/${specId}/export`)).status, 202);
  assert.equal((await post(`/api/spec/${specId}/export`)).status, 409, 'already requested → refused');
});

test('re-export is allowed once the previous one finished', async () => {
  attach(specId, 'sess-1');
  await post(`/api/spec/${specId}/export`);
  finishExport(specId, { url: 'https://docs.google.com/document/d/done/edit' });
  assert.equal((await post(`/api/spec/${specId}/export`)).status, 202, 'done → re-export allowed');
});

test('POST export 404s for an unknown spec', async () => {
  const r = await post('/api/spec/deadbeef00/export');
  assert.equal(r.status, 404);
});

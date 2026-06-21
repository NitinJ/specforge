// HTTP tests for the organize endpoints: POST /rename (meta + spec heading),
// PATCH /organize (tags / collection), validation and 404s.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec, readSpecHtml } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dorg-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  specId = createSpec({ title: 'Before', html: '<html><head><title>Before</title></head><body><h1>Before</h1></body></html>' });
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

const send = (method, path, body) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /rename updates the title and the spec heading', async () => {
  const r = await send('POST', `/api/spec/${specId}/rename`, { title: '  After  ' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).title, 'After');
  assert.equal(readMeta(specId).title, 'After');
  assert.match(readSpecHtml(specId), /<h1>After<\/h1>/);
});

test('POST /rename rejects an empty title (400)', async () => {
  const r = await send('POST', `/api/spec/${specId}/rename`, { title: '   ' });
  assert.equal(r.status, 400);
});

test('PATCH /organize sets tags and collection (sanitized)', async () => {
  const r = await send('PATCH', `/api/spec/${specId}/organize`, { tags: [' api ', 'api', 'auth'], collection: ' Launch ' });
  assert.equal(r.status, 200);
  const { tags, collection } = await r.json();
  assert.deepEqual(tags, ['api', 'auth']);
  assert.equal(collection, 'Launch');
  const m = readMeta(specId);
  assert.deepEqual(m.tags, ['api', 'auth']);
  assert.equal(m.collection, 'Launch');
});

test('PATCH /organize only touches the keys provided', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { tags: ['x'], collection: 'C' });
  await send('PATCH', `/api/spec/${specId}/organize`, { collection: '' }); // clear collection only
  const m = readMeta(specId);
  assert.deepEqual(m.tags, ['x'], 'tags untouched');
  assert.equal(m.collection, null, 'collection cleared');
});

test('organize endpoints 404 for an unknown spec', async () => {
  assert.equal((await send('POST', '/api/spec/deadbeef00/rename', { title: 'x' })).status, 404);
  assert.equal((await send('PATCH', '/api/spec/deadbeef00/organize', { tags: [] })).status, 404);
});

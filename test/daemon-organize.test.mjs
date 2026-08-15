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

test('template specs are protected: rename / organize / status are refused (403)', async () => {
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  const tid = templateId('design');
  assert.equal((await send('POST', `/api/spec/${tid}/rename`, { title: 'Hijack' })).status, 403);
  assert.equal((await send('PATCH', `/api/spec/${tid}/organize`, { collection: 'Elsewhere' })).status, 403);
  assert.equal((await send('POST', `/api/spec/${tid}/status`, { status: 'closed' })).status, 403);
  const m = readMeta(tid);
  assert.equal(m.title, 'Template · design', 'title untouched');
  assert.equal(m.collection, 'Templates', 'collection untouched');
  assert.equal(m.status, 'draft', 'status untouched');
});

test('the Templates collection is reserved — normal specs cannot be organized into it', async () => {
  const r = await send('PATCH', `/api/spec/${specId}/organize`, { collection: 'templates' });
  assert.equal(r.status, 400);
  assert.equal(readMeta(specId).collection, null, 'collection unchanged');
});

test('DELETE /api/spec/:id removes a spec and drops it from its session', async () => {
  const { attach, specsForSession } = await import('../lib/attach.mjs');
  const { existsSync } = await import('node:fs');
  const { specDir } = await import('../lib/store.mjs');
  attach(specId, 'sess-del');
  assert.deepEqual(specsForSession('sess-del'), [specId], 'attached first');
  const r = await send('DELETE', `/api/spec/${specId}`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: specId });
  assert.equal(existsSync(specDir(specId)), false, 'spec dir removed');
  assert.equal(readMeta(specId), null, 'meta gone');
  assert.deepEqual(specsForSession('sess-del'), [], 'dropped from the session index');
});

test('DELETE /api/spec/:id 404s for an unknown spec', async () => {
  assert.equal((await send('DELETE', '/api/spec/deadbeef00')).status, 404);
});

test('DELETE is refused for a protected template spec (403)', async () => {
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  const tid = templateId('impl');
  const r = await send('DELETE', `/api/spec/${tid}`);
  assert.equal(r.status, 403);
  assert.ok(readMeta(tid), 'template spec survives');
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

// ---- projects ----

test('PATCH /organize sets the project (sanitized) and returns it', async () => {
  const r = await send('PATCH', `/api/spec/${specId}/organize`, { project: '  figur   design studio ' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).project, 'figur design studio');
  assert.equal(readMeta(specId).project, 'figur design studio');
});

test('a project-only PATCH leaves tags and collection alone', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { tags: ['x'], collection: 'Research' });
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'specforge' });
  const m = readMeta(specId);
  assert.deepEqual(m.tags, ['x'], 'tags untouched');
  assert.equal(m.collection, 'Research', 'collection untouched');
  assert.equal(m.project, 'specforge');
});

test('a spec moved between projects keeps its collection', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'a', collection: 'Research' });
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'b' });
  const m = readMeta(specId);
  assert.equal(m.project, 'b');
  assert.equal(m.collection, 'Research', 'the address moves one half at a time');
});

test('an empty or null project clears it back to unfiled', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'a' });
  await send('PATCH', `/api/spec/${specId}/organize`, { project: '' });
  assert.equal(readMeta(specId).project, null);
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'a' });
  await send('PATCH', `/api/spec/${specId}/organize`, { project: null });
  assert.equal(readMeta(specId).project, null);
});

test('a collection-only PATCH leaves the project alone', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'a', collection: 'c' });
  await send('PATCH', `/api/spec/${specId}/organize`, { collection: '' });
  const m = readMeta(specId);
  assert.equal(m.project, 'a', 'project untouched');
  assert.equal(m.collection, null);
});

test('a template spec cannot be filed into a project (403)', async () => {
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  const tid = templateId('design');
  assert.equal((await send('PATCH', `/api/spec/${tid}/organize`, { project: 'figur' })).status, 403);
  assert.equal(readMeta(tid).project ?? null, null, 'template stays outside every project');
});

test('GET /api/spec/:id/meta carries the project for the owner', async () => {
  await send('PATCH', `/api/spec/${specId}/organize`, { project: 'figur' });
  const meta = await (await fetch(`${base}/api/spec/${specId}/meta`)).json();
  assert.equal(meta.project, 'figur');
});

test('owner meta reports an unfiled spec as null, not undefined', async () => {
  const meta = await (await fetch(`${base}/api/spec/${specId}/meta`)).json();
  assert.equal(meta.project, null);
});

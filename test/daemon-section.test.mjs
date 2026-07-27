// HTTP tests for the inline section editor endpoints:
//   GET  /api/spec/:id/section/:sid → the section's clean inner html (from disk)
//   PUT  /api/spec/:id/section/:sid → replace that section's inner html on disk
// The browser edits clean source (not the chrome-polluted served DOM), and the
// write goes back to the canonical spec.html (triggering the live reload).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec, readSpecHtml } from '../lib/store.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

const SPEC_HTML =
  '<html><head><title>T</title></head><body><h1>T</h1>' +
  '<section id="a" class="lead"><h2>A</h2><p>old</p></section>' +
  '<section id="b"><p>b</p></section></body></html>';

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dsec-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  specId = createSpec({ title: 'T', html: SPEC_HTML });
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
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('GET /section/:sid returns the section inner html from disk', async () => {
  const r = await send('GET', `/api/spec/${specId}/section/a`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.sectionId, 'a');
  assert.equal(b.html, '<h2>A</h2><p>old</p>', 'clean inner html, wrapper excluded');
});

test('GET /section/:sid 404s for an unknown section', async () => {
  assert.equal((await send('GET', `/api/spec/${specId}/section/nope`)).status, 404);
});

test('GET /section/:sid 404s for an unknown spec', async () => {
  assert.equal((await send('GET', '/api/spec/deadbeef00/section/a')).status, 404);
});

test('PUT /section/:sid replaces the section inner and persists to disk', async () => {
  const r = await send('PUT', `/api/spec/${specId}/section/a`, { html: '<h2>A</h2><p>new body</p>' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const disk = readSpecHtml(specId);
  assert.match(disk, /<section id="a" class="lead"><h2>A<\/h2><p>new body<\/p><\/section>/,
    'wrapper preserved, inner replaced on disk');
  assert.match(disk, /<section id="b"><p>b<\/p><\/section>/, 'sibling section untouched');
});

test('PUT /section/:sid rejects a missing/non-string html body (400)', async () => {
  assert.equal((await send('PUT', `/api/spec/${specId}/section/a`, {})).status, 400);
  assert.equal((await send('PUT', `/api/spec/${specId}/section/a`, { html: 42 })).status, 400);
});

test('PUT /section/:sid 404s for an unknown section', async () => {
  assert.equal((await send('PUT', `/api/spec/${specId}/section/nope`, { html: '<p>x</p>' })).status, 404);
});

test('PUT /section/:sid 404s for an unknown spec', async () => {
  assert.equal((await send('PUT', '/api/spec/deadbeef00/section/a', { html: '<p>x</p>' })).status, 404);
});

test('section content is editable on a protected template spec (that IS the template-editing flow)', async () => {
  const { ensureTemplates, templateId } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  const tid = templateId('design');
  // The template seed has real <section id> blocks; grab one, edit it, expect 200.
  const first = readSpecHtml(tid).match(/<section id="([\w-]+)"/);
  assert.ok(first, 'template has an id-bearing section');
  const sid = first[1];
  const r = await send('PUT', `/api/spec/${tid}/section/${sid}`, { html: '<p>edited template body</p>' });
  assert.equal(r.status, 200, 'template content edits are allowed');
  assert.match(readSpecHtml(tid), /<p>edited template body<\/p>/);
});

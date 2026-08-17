// The one route that removes content from a spec's body.
//
// `removeAside` is tested on its own; this covers what the HTTP layer adds —
// which requests are refused, and with what status. The guards matter more than
// the success path: a route that deletes a section by id is one bad id away from
// removing a reader's own writing, and the only thing between those two outcomes
// is that a section without `data-sf-aside` is refused.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'sf-aside-api-'));
process.env.SPECFORGE_HOME = HOME;

const { handleAsideDelete } = await import('../lib/store-api.mjs');
const { readSpecHtml, writeSpecHtml } = await import('../lib/store.mjs');
const { specDir } = await import('../lib/store-paths.mjs');

const SPEC = `<main>
  <section id="object"><h2>1 · Object</h2><p>First.</p></section>
  <section id="object-aside-1" data-sf-aside="object" data-sf-action="visualize">
    <h3>Aside: Visualize</h3><p>A diagram.</p></section>
</main>`;

function seed(id, meta = {}) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: 'T', status: 'draft', ...meta }));
  writeSpecHtml(id, SPEC);
  return id;
}

/** The bit of a ServerResponse sendJson touches. */
function fakeRes() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(text) { this.body = JSON.parse(text); },
  };
}

test('deleting an aside answers 200 and says what went', () => {
  const id = seed('api_a');
  const res = fakeRes();
  handleAsideDelete(id, 'object-aside-1', res);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.aside, 'object-aside-1');
  assert.equal(res.body.section, 'object');
  assert.equal(readSpecHtml(id).includes('object-aside-1'), false);
});

test('naming a section that is not an aside is refused, and the section stays', () => {
  // The guard the route exists around. A client that could pass any section id
  // could delete the reader's own writing.
  const id = seed('api_b');
  const res = fakeRes();
  handleAsideDelete(id, 'object', res);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not an aside/);
  assert.equal(readSpecHtml(id).includes('id="object"'), true);
});

test('an unknown section is refused', () => {
  const id = seed('api_c');
  const res = fakeRes();
  handleAsideDelete(id, 'nope', res);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no section/);
});

test('an unknown spec is 404 rather than an error from the splicer', () => {
  const res = fakeRes();
  handleAsideDelete('api_missing', 'object-aside-1', res);
  assert.equal(res.status, 404);
});

test('a template spec is protected, the same as every other write route', () => {
  // A template is the source future specs are scaffolded from. Its identity is
  // fixed, and an aside on one is part of what it teaches.
  const id = seed('api_t', { template: true });
  const res = fakeRes();
  handleAsideDelete(id, 'object-aside-1', res);
  assert.equal(res.status, 403);
  assert.equal(readSpecHtml(id).includes('object-aside-1'), true);
});

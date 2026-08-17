// The block-delete route.
//
// `deleteBlock` is tested on its own; this is what the HTTP layer adds. The
// statuses carry meaning here: a 409 says the page is out of date, and the
// client tells the reader to reload rather than reporting a bad request they
// cannot act on.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'sf-block-api-'));
process.env.SPECFORGE_HOME = HOME;

const { handleBlockDelete } = await import('../lib/store-api.mjs');
const { readSpecHtml, writeSpecHtml } = await import('../lib/store.mjs');
const { specDir } = await import('../lib/store-paths.mjs');

const SPEC = `<main>
  <section id="one"><h2>1 · One</h2><p>Keep me.</p><p>Cut me.</p></section>
  <section id="one-aside-1" data-sf-aside="one" data-sf-action="visualize"><p>A draft.</p></section>
</main>`;

function seed(id, meta = {}) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: 'T', status: 'draft', ...meta }));
  writeSpecHtml(id, SPEC);
  return id;
}

function fakeRes() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(text) { this.body = JSON.parse(text); },
  };
}

test('deleting a block answers 200 and says what went', () => {
  const id = seed('blk_a');
  const res = fakeRes();
  handleBlockDelete(id, { section: 'one', tag: 'P', text: 'Cut me.' }, res);
  assert.equal(res.status, 200);
  assert.equal(res.body.section, 'one');
  assert.equal(readSpecHtml(id).includes('Cut me.'), false);
  assert.equal(readSpecHtml(id).includes('Keep me.'), true);
});

test('a block that no longer reads that way is a 409, not a 400', () => {
  // The difference matters to the reader: this is not a malformed request, it is
  // a page showing something the file no longer says, and the fix is a reload.
  const id = seed('blk_b');
  const res = fakeRes();
  handleBlockDelete(id, { section: 'one', tag: 'P', text: 'Some older wording.' }, res);
  assert.equal(res.status, 409);
  assert.equal(readSpecHtml(id).includes('Cut me.'), true, 'and nothing was removed');
});

test('a request missing any of the three identifiers is refused', () => {
  const id = seed('blk_c');
  for (const body of [
    { tag: 'P', text: 'Cut me.' },
    { section: 'one', text: 'Cut me.' },
    { section: 'one', tag: 'P' },
    {},
  ]) {
    const res = fakeRes();
    handleBlockDelete(id, body, res);
    assert.equal(res.status, 400, `${JSON.stringify(body)} should be refused`);
  }
  assert.equal(readSpecHtml(id).includes('Cut me.'), true);
});

test('a draft is refused: it has its own delete', () => {
  const id = seed('blk_d');
  const res = fakeRes();
  handleBlockDelete(id, { section: 'one-aside-1', tag: 'P', text: 'A draft.' }, res);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /draft/);
  assert.equal(readSpecHtml(id).includes('A draft.'), true);
});

test('an unknown spec is 404 and a template is 403', () => {
  const missing = fakeRes();
  handleBlockDelete('blk_missing', { section: 'one', tag: 'P', text: 'Cut me.' }, missing);
  assert.equal(missing.status, 404);

  const id = seed('blk_t', { template: true });
  const tpl = fakeRes();
  handleBlockDelete(id, { section: 'one', tag: 'P', text: 'Cut me.' }, tpl);
  assert.equal(tpl.status, 403);
  assert.equal(readSpecHtml(id).includes('Cut me.'), true);
});

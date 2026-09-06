// Exporting a tree.
//
// Two shapes, because the consumers differ. Markdown goes to a repo or another
// agent, which want the files, so a subtree becomes a zip laid out by the tree.
// Print and Google Docs go to a reader, and a Doc has no folder, so those get
// one flattened document.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { startDaemon } from './helpers/daemon-harness.mjs';
import { poison, unpoisonAll, needsPoison } from './helpers/fs-probe.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-exp-');

let d;
beforeEach(async () => { d = await startDaemon(); });
afterEach(async () => {
  unpoisonAll();
  if (d) { await d.close(); d = null; }
});

const specHtml = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head>`
  + `<body><h1>${title}</h1><section id="tldr"><h2>TL;DR</h2><p>${title} body.</p></section></body></html>`;

/** The entry names in a zip, read from the local file headers. */
function zipNames(buf) {
  const names = [];
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLen = buf.readUInt16LE(i + 26);
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'));
  }
  return names;
}

// ── markdown ────────────────────────────────────────────────────────────────

test('a leaf still exports as a single markdown file', async () => {
  const id = seedSpec({ title: 'Alone', html: specHtml('Alone') });
  const res = await d.get(`/api/spec/${id}/md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(await res.text(), /Alone/);
});

test('a parent exports as a zip, laid out by the tree', async () => {
  const root = seedSpec({ title: 'Root spec', html: specHtml('Root spec') });
  seedSpec({ title: 'Child one', parent: root, html: specHtml('Child one') });
  const two = seedSpec({ title: 'Child two', parent: root, html: specHtml('Child two') });
  seedSpec({ title: 'Grandchild', parent: two, html: specHtml('Grandchild') });

  const res = await d.get(`/api/spec/${root}/md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/zip/);

  const names = zipNames(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(names.sort(), [
    'root-spec.md',
    'root-spec/child-one.md',
    'root-spec/child-two.md',
    'root-spec/child-two/grandchild.md',
  ].sort());
});

test('a child that cannot be exported is named rather than failing the archive', needsPoison, async () => {
  const root = seedSpec({ title: 'Root spec', html: specHtml('Root spec') });
  const bad = seedSpec({ title: 'Unreadable', parent: root, html: specHtml('Unreadable') });
  seedSpec({ title: 'Fine', parent: root, html: specHtml('Fine') });

  poison(specHtmlPath(bad));
  const res = await d.get(`/api/spec/${root}/md`);
  assert.equal(res.status, 200);

  const names = zipNames(Buffer.from(await res.arrayBuffer()));
  assert.ok(names.includes('root-spec.md'));
  assert.ok(names.includes('root-spec/fine.md'), 'one bad descendant cost a good one');
  assert.ok(names.includes('NOT-EXPORTED.txt'), 'the archive is silent about what is missing');
});

// ── the flat view ───────────────────────────────────────────────────────────

test('the flat view carries the whole subtree in one document', async () => {
  const root = seedSpec({ title: 'Root spec', html: specHtml('Root spec') });
  seedSpec({ title: 'Child one', parent: root, html: specHtml('Child one') });

  const res = await d.get(`/spec/${root}?flat=1`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Root spec/);
  assert.match(html, /Child one/);
});

test('the flat view carries no review layer, because a printer is reading it', async () => {
  const root = seedSpec({ title: 'Root', html: specHtml('Root') });
  seedSpec({ title: 'Child', parent: root, html: specHtml('Child') });

  const html = await (await d.get(`/spec/${root}?flat=1`)).text();
  assert.doesNotMatch(html, /review\.js/);
  assert.doesNotMatch(html, /window\.SPECFORGE/);
});

test('the ordinary spec page is unaffected by the flag being absent', async () => {
  const id = seedSpec({ title: 'Root', html: specHtml('Root') });
  const html = await (await d.get(`/spec/${id}`)).text();
  assert.match(html, /review\.js/);
});

test('the flat view of an unknown spec is a 404', async () => {
  assert.equal((await d.get('/spec/0000000000?flat=1')).status, 404);
});

test('the flat view of a leaf is just that spec', async () => {
  const id = seedSpec({ title: 'Only', html: specHtml('Only') });
  const html = await (await d.get(`/spec/${id}?flat=1`)).text();
  assert.match(html, /Only/);
});

test('section ids stay unique across the flattened subtree', async () => {
  const root = seedSpec({ title: 'Root', html: specHtml('Root') });
  seedSpec({ title: 'A', parent: root, html: specHtml('A') });
  seedSpec({ title: 'B', parent: root, html: specHtml('B') });

  const html = await (await d.get(`/spec/${root}?flat=1`)).text();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
});

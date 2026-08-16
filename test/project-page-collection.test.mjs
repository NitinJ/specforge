// The collection label on a shared project page's rows.
//
// A reviewer holding a project link sees title, type, status and an update
// stamp. The collection a spec is filed under is on its meta and was not
// rendered, so the grouping the owner works with was invisible to the reader.
// Spec f081f883da, level 1: show the label. Filtering, a rail and grouping are
// deferred there and deliberately absent here.
//
// A contributed row is a spec another machine serves. This machine holds no
// meta for it, so it carries no collection label rather than a blank one.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pcoll-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { renderProjectPage } = await import('../server/project-page.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { readMeta, writeMeta } = await import('../lib/meta.mjs');
const { writeProjectShare, addContribution } = await import('../lib/store-project-shares.mjs');

const TOK = 'c'.repeat(32);

function seed(title, collection = null, project = 'Atelier') {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = project;
  m.collection = collection;
  writeMeta(id, m);
  return id;
}

/** The markup of the one row whose title matches, so page-wide regexes can't lie. */
function rowFor(html, title) {
  const rows = html.match(/<li class="row">[\s\S]*?<\/li>/g) || [];
  const hit = rows.find((r) => r.includes(title));
  assert.ok(hit, `a row for ${title}`);
  return hit;
}

test('a collected spec shows its collection name', () => {
  seed('Widget themes', 'Data models');
  const row = rowFor(renderProjectPage('Atelier', TOK), 'Widget themes');
  assert.match(row, /Data models/, 'the collection name is on the row');
});

test('an uncollected spec shows no collection markup at all', () => {
  seed('Loose spec', null);
  const row = rowFor(renderProjectPage('Atelier', TOK), 'Loose spec');
  assert.doesNotMatch(row, /class="coll"/, 'no empty chip where a name would be');
});

test('the label is the spec’s own collection, not another row’s', () => {
  seed('Filed', 'Data models');
  seed('Unfiled', null);
  const html = renderProjectPage('Atelier', TOK);
  assert.match(rowFor(html, 'Filed'), /Data models/);
  assert.doesNotMatch(rowFor(html, 'Unfiled'), /Data models/);
});

test('a collection name is escaped, not injected', () => {
  seed('Sharp', '<img src=x onerror=alert(1)>');
  const html = renderProjectPage('Atelier', TOK);
  assert.doesNotMatch(html, /<img src=x/, 'the tag never reaches the page raw');
  assert.match(html, /&lt;img src=x/, 'it is escaped instead');
});

test('a contributed row carries no collection label', () => {
  writeProjectShare('Atelier', { token: TOK, createdAt: new Date().toISOString() });
  addContribution('Atelier', {
    origin: 'https://elsewhere.example',
    token: 'd'.repeat(32),
    title: 'Their spec',
    owner: 'someone',
  });
  const row = rowFor(renderProjectPage('Atelier', TOK), 'Their spec');
  assert.doesNotMatch(row, /class="coll"/, 'this machine holds no collection for it');
});

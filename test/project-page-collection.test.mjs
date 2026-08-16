// Collection sections on a shared project page.
//
// A reviewer holding a project link saw one flat list. The collection a spec is
// filed under is on its meta, so the grouping the owner works with was
// invisible: 20 specs over 6 collections read as 20 undifferentiated rows.
//
// The page now groups under collection headings, which is what the owner sees
// for the same project on their own home page. Ordering is groupByCollection's,
// shared with the home page (lib/collections.mjs) so the two cannot disagree.
//
// Spec f081f883da. Filtering and a clickable rail are deferred there.

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
const { writeGlobalPrefs } = await import('../lib/global-prefs.mjs');

const TOK = 'c'.repeat(32);

function seed(title, collection = null, project = 'Atelier') {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = project;
  m.collection = collection;
  writeMeta(id, m);
  return id;
}

/** The heading text of each section, in the order they appear. */
function headings(html) {
  return [...html.matchAll(/<h2>([^<]*)</g)].map((m) => m[1].trim())
    .filter((h) => h && h !== 'Add to my SpecForge');
}

/** The markup of the section whose heading matches, so page-wide regexes can't lie. */
function sectionFor(html, heading) {
  const secs = html.match(/<section class="grp">[\s\S]*?<\/section>/g) || [];
  const hit = secs.find((s) => new RegExp(`<h2>${heading}\\b`).test(s));
  assert.ok(hit, `a section headed ${heading}`);
  return hit;
}

test('specs are grouped under their collection', () => {
  seed('Object model', 'Data models');
  seed('Widget themes', 'UX');
  const html = renderProjectPage('Atelier', TOK);
  assert.match(sectionFor(html, 'Data models'), /Object model/);
  assert.match(sectionFor(html, 'UX'), /Widget themes/);
  assert.doesNotMatch(sectionFor(html, 'UX'), /Object model/, 'and not under another');
});

test('each heading carries the count of what is under it', () => {
  seed('One', 'Data models');
  seed('Two', 'Data models');
  seed('Three', 'UX');
  const html = renderProjectPage('Atelier', TOK);
  assert.match(sectionFor(html, 'Data models'), /<span class="gcount">2</);
  assert.match(sectionFor(html, 'UX'), /<span class="gcount">1</);
});

test('uncollected specs sit in their own group, last', () => {
  seed('Filed', 'Data models');
  seed('Loose', null);
  const heads = headings(renderProjectPage('Atelier', TOK));
  assert.deepEqual(heads, ['Data models', 'Uncollected']);
});

test('a project with no collections at all gets no headings', () => {
  // specforge is this case in the real store: 23 specs, 0 collections. One
  // heading over every row would name nothing.
  seed('Alpha', null);
  seed('Beta', null);
  const html = renderProjectPage('Atelier', TOK);
  assert.deepEqual(headings(html), []);
  assert.match(html, /Alpha/);
  assert.match(html, /Beta/);
});

test('group order follows the owner’s arrangement, then alphabetical', () => {
  writeGlobalPrefs({ collectionOrder: ['Zulu'] });
  seed('z', 'Zulu');
  seed('a', 'Alpha');
  seed('m', 'Mike');
  // Zulu is ranked, so it leads despite sorting last alphabetically; the rest
  // follow A-Z. Same rule as the home page (lib/collections.mjs).
  assert.deepEqual(headings(renderProjectPage('Atelier', TOK)), ['Zulu', 'Alpha', 'Mike']);
});

test('a collection name is escaped, not injected', () => {
  seed('Sharp', '<img src=x onerror=alert(1)>');
  const html = renderProjectPage('Atelier', TOK);
  assert.doesNotMatch(html, /<img src=x/, 'the tag never reaches the page raw');
  assert.match(html, /&lt;img src=x/, 'it is escaped instead');
});

test('contributed specs are their own group, after the collections', () => {
  seed('Mine', 'Data models');
  writeProjectShare('Atelier', { token: TOK, createdAt: new Date().toISOString() });
  addContribution('Atelier', {
    origin: 'https://elsewhere.example',
    token: 'd'.repeat(32),
    title: 'Their spec',
    owner: 'someone',
  });
  const html = renderProjectPage('Atelier', TOK);
  // This machine holds no collection for a spec another machine serves, so
  // filing it under one of the owner's groups would claim something untrue.
  assert.deepEqual(headings(html), ['Data models', 'From other machines']);
  assert.match(sectionFor(html, 'From other machines'), /Their spec/);
  assert.doesNotMatch(sectionFor(html, 'Data models'), /Their spec/);
});

test('the row itself no longer repeats the collection name', () => {
  seed('Object model', 'Data models');
  const html = renderProjectPage('Atelier', TOK);
  const row = (html.match(/<li class="row">[\s\S]*?<\/li>/) || [''])[0];
  assert.doesNotMatch(row, /Data models/,
    'the heading says it once; on the row it would say it per spec');
});

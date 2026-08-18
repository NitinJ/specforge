// The home page once specs have projects: the rail, the grouping, and the
// counts. Server-rendered structure only; the interaction that drives it lives
// in index-page-projects-dom.test.mjs.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { writeGlobalPrefs } from '../lib/global-prefs.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { seedProjects } from './helpers/project-store.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-projidx-');

/** The rail's project rows, top to bottom, as [label, count]. */
function railProjects(html) {
  const nav = html.match(/<nav class="projs"[^>]*>([\s\S]*?)<\/nav>/);
  if (!nav) return [];
  return [...nav[1].matchAll(/<button class="pnav[^"]*"[^>]*><span class="projname">([^<]*)<\/span><span class="nc">(\d+)<\/span>/g)]
    .map((m) => [m[1], Number(m[2])]);
}

/** The project sections, in render order, as [projectKey, [collectionKey, ...]]. */
function groupTree(html) {
  // The class list carries `lead` on whichever section is shown first, so match
  // it loosely; the data attribute is what identifies the section.
  return [...html.matchAll(/<section class="pgrp[^"]*" data-p="([^"]*)"[^>]*>([\s\S]*?)(?=<section class="pgrp|<\/div>\n<div id="nohits")/g)]
    .map(([, p, body]) => [p, [...body.matchAll(/<section class="grp[^"]*" data-p="[^"]*" data-coll="([^"]*)"/g)].map((m) => m[1])]);
}

test('with no projects anywhere the page reads exactly as it did before', () => {
  seedProjects({ '': { Research: 2, '': 3 } });
  const html = renderIndex();

  // One pseudo-project holding everything, and the collections inside it are
  // grouped and ordered the way collections have always been.
  assert.deepEqual(groupTree(html), [['', ['Research', '']]]);
  assert.deepEqual(railProjects(html), [['All projects', 5], ['No project', 5]]);
});

test('named projects render before No project, which is always last', () => {
  writeGlobalPrefs({ projects: ['specforge', 'figur'] });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 2 }, '': { '': 1 } });
  const html = renderIndex();

  assert.deepEqual(groupTree(html).map(([p]) => p), ['specforge', 'figur', '']);
  assert.deepEqual(railProjects(html), [
    ['All projects', 4], ['specforge', 2], ['figur', 1], ['No project', 1],
  ]);
});

test('a project the stored order does not name falls in after, alphabetically', () => {
  writeGlobalPrefs({ projects: ['zulu'] });
  seedProjects({ zulu: { '': 1 }, bravo: { '': 1 }, alpha: { '': 1 } });
  assert.deepEqual(groupTree(renderIndex()).map(([p]) => p), ['zulu', 'alpha', 'bravo']);
});

test('a project with no specs keeps its place in the rail, at zero', () => {
  writeGlobalPrefs({ projects: ['figur', 'empty-one'] });
  seedProjects({ figur: { UI: 1 } });
  const rail = railProjects(renderIndex());

  assert.deepEqual(rail, [['All projects', 1], ['figur', 1], ['empty-one', 0], ['No project', 0]]);
});

test('the same collection name in two projects is two groups, counted separately', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 3 }, specforge: { UI: 1 } });
  const html = renderIndex();

  assert.deepEqual(groupTree(html), [['figur', ['UI']], ['specforge', ['UI']]]);
  const counts = [...html.matchAll(/data-coll="UI">\s*<h2>UI <span class="gcount">(\d+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(counts, ['3', '1']);
});

/** The collections rail's rows, top to bottom, as [name, count]. */
function railCollections(html) {
  const nav = html.match(/<nav class="colls"[^>]*>([\s\S]*?)<\/nav>/)[1];
  return [...nav.matchAll(/<div class="crow" data-c="([^"]*)"[\s\S]*?<span class="nc">(\d+)<\/span>/g)]
    .map((m) => [m[1], Number(m[2])]);
}

test('the collections rail lists each distinct name once, across every project', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 1, Product: 1 }, specforge: { UI: 1, Engineering: 1 } });

  // One row per name, not one per (project, collection) pair: the rail is the
  // order, and the order is a flat list of names shared across projects, so a
  // name has one row and one rank wherever it is used.
  assert.deepEqual(railCollections(renderIndex()).map(([n]) => n), ['Engineering', 'Product', 'UI']);
});

test('Uncollected joins the collections rail only when something is uncollected', () => {
  seedProjects({ figur: { UI: 1 } });
  assert.deepEqual(railCollections(renderIndex()).map(([n]) => n), ['UI']);

  seedProjects({ figur: { '': 1 } });
  assert.deepEqual(railCollections(renderIndex()).map(([n]) => n), ['UI', '']);
});

test('collection counts in the rail are counted within the selected project', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'], project: 'figur' });
  seedProjects({ figur: { UI: 3 }, specforge: { UI: 1, Engineering: 4 } });

  // Engineering has no members in figur, so it renders at zero and the client
  // hides it. The count is the selected project's, never the store's total.
  assert.deepEqual(railCollections(renderIndex()), [['Engineering', 0], ['UI', 3]]);
});

test('with All projects selected the rail counts across the whole store', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 3 }, specforge: { UI: 1 } });
  assert.deepEqual(railCollections(renderIndex()), [['UI', 4]]);
});

test('every row carries its project, and its project is searchable', () => {
  seedProjects({ 'figur-design-studio': { UI: ['Wardrobe grid'] } });
  const html = renderIndex();

  assert.match(html, /data-p="figur-design-studio"/);
  const key = html.match(/<li class="row[^"]*" data-k="([^"]*)"/)[1];
  assert.ok(key.includes('figur-design-studio'), 'the project name is in the search key');
  assert.ok(key.includes('wardrobe grid'), 'and so is the title, lowercased');
});

test('an unfiled row carries an empty project, not the words No project', () => {
  seedProjects({ '': { '': 1 } });
  const row = renderIndex().match(/<li class="row[^"]*"[^>]*data-p="([^"]*)"/);
  assert.equal(row[1], '', 'the pseudo-project is a label, never a stored value');
});

test('the selected project is marked in the rail and named in the header', () => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, '': { '': 1 } });
  const html = renderIndex();

  assert.match(html, /<button class="pnav on"[^>]*data-p="figur"/);
  assert.match(html, /id="htitle">figur</);
});

test('no stored selection lands on All projects', () => {
  seedProjects({ figur: { UI: 1 } });
  const html = renderIndex();
  assert.match(html, /<button class="pnav on"[^>]*data-all="1"/);
  assert.match(html, /id="htitle">All specs</);
});

test('a selection hides the other projects in the markup, not only in script', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 }, '': { '': 1 } });
  const html = renderIndex();

  // The header and the counts already say "figur". The sections have to agree
  // before any script runs, or the page contradicts itself on first paint.
  assert.match(html, /<section class="pgrp lead" data-p="figur">/,
    'the selected one is shown, and carries the top-of-list spacing');
  assert.match(html, /<section class="pgrp" data-p="specforge" style="display:none">/);
  assert.match(html, /<section class="pgrp" data-p="" style="display:none">/);
  assert.match(html, /<body class="inproj">/, 'and the project headings give way to the page header');
});

test('All projects renders every section visible and no inproj flag', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'] });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 } });
  const html = renderIndex();

  assert.equal(/style="display:none"/.test(html.match(/<div id="groups">[\s\S]*?<\/div>\n<div id="nohits"/)[0]), false);
  assert.match(html, /<body>/);
});

test('?project= selects a project for this render, over what is stored', () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 1 } });

  const html = renderIndex({ project: 'specforge' });
  assert.match(html, /<button class="pnav on"[^>]*data-p="specforge"/);
  assert.match(html, /id="htitle">specforge</);
  assert.match(html, /<section class="pgrp" data-p="figur" style="display:none">/);
});

test('?project= naming nothing that exists falls back to All projects', () => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });
  assert.match(renderIndex({ project: 'deleted-elsewhere' }), /<button class="pnav on"[^>]*data-all="1"/);
});

test('?project= with an empty value selects No project, not All projects', () => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, '': { '': 1 } });
  assert.match(renderIndex({ project: '' }), /<button class="pnav on"[^>]*data-p=""/);
});

test('no ?project= leaves the stored selection alone', () => {
  writeGlobalPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });
  assert.match(renderIndex({ project: null }), /<button class="pnav on"[^>]*data-p="figur"/);
  assert.match(renderIndex(), /<button class="pnav on"[^>]*data-p="figur"/);
});

test('a selection naming a project that no longer exists falls back to All projects', () => {
  writeGlobalPrefs({ project: 'deleted-elsewhere' });
  seedProjects({ figur: { UI: 1 } });
  const html = renderIndex();
  assert.match(html, /<button class="pnav on"[^>]*data-all="1"/);
});

test('No project is selectable in its own right', () => {
  writeGlobalPrefs({ project: '' });
  seedProjects({ figur: { UI: 1 }, '': { '': 2 } });
  const html = renderIndex();
  assert.match(html, /<button class="pnav on"[^>]*data-p=""/);
  assert.match(html, /id="htitle">No project</);
});

test('templates appear in no project group, being off this page entirely', async () => {
  // The strip moved to /settings (P7). What still has to hold here is that a
  // template never turns up inside somebody's project.
  const { ensureTemplates } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  writeGlobalPrefs({ projects: ['figur'] });
  seedProjects({ figur: { UI: 1 } });
  const html = renderIndex();

  assert.equal(html.match(/<section class="tpls">/g), null, 'no strip on the home page');
  for (const [, colls] of groupTree(html)) assert.ok(!colls.includes('Templates'));
});

test('the project rail offers a way to make a new one', () => {
  seedProjects({ '': { '': 1 } });
  const html = renderIndex();
  assert.match(html, /id="projnew"/);
  // Not `pnew`: the collection picker already owns that id for its create
  // button, and two elements sharing it would make getElementById ambiguous.
  assert.equal(html.match(/id="pnew"/g).length, 1, 'the picker keeps sole claim on pnew');
});

test('a project name is escaped everywhere it is rendered', () => {
  writeGlobalPrefs({ projects: ['<img src=x onerror=alert(1)>'] });
  seedProjects({ '<img src=x onerror=alert(1)>': { '': 1 } });
  const html = renderIndex();

  assert.ok(!html.includes('<img src=x'), 'no unescaped markup reaches the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'it is rendered as text');
});

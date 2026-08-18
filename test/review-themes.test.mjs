// The theme catalog, checked across the three files that have to agree about it.
//
// A theme is declared in three places and none of them can see the others: the
// id whitelist in the store, the picker's catalog in review.js, and two CSS
// rules in review.css (the palette the page renders in, and the thumbnail the
// picker draws). Adding a theme to some of them and not the rest is silent: the
// page looks right and one surface is wrong.
//
// Both drifts below were made while building the picker and were caught by
// looking at a rendered dropdown, which is the reason this file exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { THEMES } from '../lib/store-prefs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'server/public/review.css'), 'utf8');
const JS = readFileSync(join(ROOT, 'server/public/review.js'), 'utf8');

/** The picker's catalog, read out of the client script. */
function catalog() {
  const block = JS.match(/var THEMES = \[([\s\S]*?)\];/);
  assert.ok(block, 'review.js declares a THEMES array');
  return [...block[1].matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*group:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1], name: m[2], group: m[3] }));
}

/** One declaration out of a CSS rule, or undefined. */
function decl(selector, prop) {
  const rule = CSS.match(
    new RegExp(selector.replace(/[.[\]"*+?^${}()|\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'),
  );
  if (!rule) return undefined;
  const m = rule[1].match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : undefined;
}

const SPEC_OWNED = ['light', 'dark']; // palettes the spec itself defines

test('the store whitelist and the picker catalog list the same themes, in the same order', () => {
  assert.deepEqual(catalog().map((t) => t.id), THEMES);
});

test('every theme is grouped light or dark, and the light family comes first', () => {
  const groups = catalog().map((t) => t.group);
  assert.deepEqual([...new Set(groups)], ['light', 'dark'], 'two groups, light first');
  assert.equal(groups.indexOf('light') < groups.indexOf('dark'), true);
  assert.equal(groups.lastIndexOf('light') < groups.indexOf('dark'), true, 'and they do not interleave');
});

test('every theme has a name a person would recognise', () => {
  for (const t of catalog()) assert.match(t.name, /^\S/, `${t.id} has a name`);
});

test('every review-layer theme declares a palette', () => {
  for (const t of catalog()) {
    if (SPEC_OWNED.includes(t.id)) continue;
    assert.ok(decl(`:root[data-theme="${t.id}"]`, '--bg'), `${t.id} has a palette block`);
  }
});

test('every theme has a thumbnail, so the picker can draw it', () => {
  for (const t of catalog()) {
    assert.ok(decl(`.sf-thumb[data-theme="${t.id}"]`, '--t-bg'), `${t.id} has a thumbnail rule`);
  }
});

test('a thumbnail shows the palette it stands for, not a colour of its own', () => {
  // Drifted twice while building the picker: the Catppuccin and Everforest
  // thumbnails advertised an accent their palettes did not use.
  for (const t of catalog()) {
    if (SPEC_OWNED.includes(t.id)) continue;
    const sel = `:root[data-theme="${t.id}"]`;
    const thumb = `.sf-thumb[data-theme="${t.id}"]`;
    assert.equal(decl(thumb, '--t-bg'), decl(sel, '--bg'), `${t.id}: thumbnail background`);
    assert.equal(decl(thumb, '--t-ink'), decl(sel, '--ink'), `${t.id}: thumbnail ink`);
    assert.equal(decl(thumb, '--t-accent'), decl(sel, '--accent'), `${t.id}: thumbnail accent`);
  }
});

test('the removed theme is gone from every file rather than from one', () => {
  assert.equal(THEMES.includes('gruvbox-light'), false, 'not in the store whitelist');
  assert.equal(/gruvbox/.test(JS), false, 'not in the picker');
  assert.equal(/gruvbox/.test(CSS), false, 'and no orphan palette or thumbnail rule');
});

test('the derived secondary vars apply to every variant without naming one', () => {
  // They used to be a list of selectors that had to be edited a second time for
  // each new theme; forgetting left that theme's code blocks near-black.
  assert.ok(
    CSS.includes(':root[data-theme]:not([data-theme="light"]):not([data-theme="dark"])'),
    'matched by exclusion, so a new theme inherits them',
  );
});

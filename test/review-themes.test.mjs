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

test('a removed theme is gone from every file rather than from one', () => {
  for (const dead of ['gruvbox-light', 'github-light', 'dracula', 'tokyo-night']) {
    assert.equal(THEMES.includes(dead), false, `${dead} is not in the store whitelist`);
    assert.equal(new RegExp(dead).test(JS), false, `${dead} is not in the picker`);
    assert.equal(new RegExp(dead).test(CSS), false, `${dead} leaves no orphan rule`);
  }
});

test('each family has seven themes', () => {
  const by = (g) => catalog().filter((t) => t.group === g).length;
  assert.equal(by('light'), 7);
  assert.equal(by('dark'), 7);
});

// --- colour separation ------------------------------------------------------
//
// The set is chosen so no two themes in a family read as the same theme. Two
// that share an accent hue and a background lightness are one theme with two
// names, which is what a picker full of near-duplicates felt like.
// scripts/profile-themes.mjs prints the full table.

const HOUSE = {
  light: { bg: '#fbfaf7', accent: '#2f6feb' },
  dark: { bg: '#0f1115', accent: '#6ea8fe' },
};
const srgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function lab(hex) {
  const [r, g, b] = srgb(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function hue(hex) {
  const [, a, b] = lab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const deltaE = (p, q) => Math.hypot(...lab(p).map((v, i) => v - lab(q)[i]));

function colours(id) {
  if (HOUSE[id]) return HOUSE[id];
  return { bg: decl(`:root[data-theme="${id}"]`, '--bg'), accent: decl(`:root[data-theme="${id}"]`, '--accent') };
}

test('no two themes in a family share an accent hue', () => {
  // Accent hue is the separator, not background: every light theme is a shade
  // of white by definition (they measure ΔE 2 to 10 apart), so two of them are
  // told apart by the colour of their links and headings. 20° is the floor the
  // set is chosen to clear; the tightest real pair is Light and Catppuccin
  // Latte at 21°, blue against mauve.
  for (const family of ['light', 'dark']) {
    const set = catalog().filter((t) => t.group === family).map((t) => ({ id: t.id, ...colours(t.id) }));
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        const gap = hueGap(hue(set[i].accent), hue(set[j].accent));
        assert.ok(gap >= 20,
          `${set[i].id} and ${set[j].id} accents are ${gap.toFixed(0)}° apart in ${family}`);
      }
    }
  }
});

test('a family covers the wheel rather than crowding one arc', () => {
  // Seven themes over 360° average 51° apart. Requiring the widest empty arc to
  // stay under 110° is what stops six blues and one green.
  for (const family of ['light', 'dark']) {
    const hues = catalog().filter((t) => t.group === family)
      .map((t) => hue(colours(t.id).accent)).sort((a, b) => a - b);
    const gaps = hues.map((h, i) => (i === hues.length - 1 ? 360 - h + hues[0] : hues[i + 1] - h));
    assert.ok(Math.max(...gaps) <= 110,
      `${family} leaves a ${Math.max(...gaps).toFixed(0)}° arc with no theme in it`);
  }
});

test('a light background and a dark one are never confusable', () => {
  const light = catalog().filter((t) => t.group === 'light').map((t) => lab(colours(t.id).bg)[0]);
  const dark = catalog().filter((t) => t.group === 'dark').map((t) => lab(colours(t.id).bg)[0]);
  assert.ok(Math.min(...light) - Math.max(...dark) > 50,
    `lightest dark is L${Math.max(...dark).toFixed(0)}, darkest light is L${Math.min(...light).toFixed(0)}`);
});

test('the accent hues walk the wheel in list order', () => {
  // The order is the picker's order, so scrolling the list is a tour of the
  // colour wheel rather than an alphabet.
  for (const family of ['light', 'dark']) {
    const hues = catalog().filter((t) => t.group === family)
      .map((t) => hue(colours(t.id).accent));
    const house = hues.shift(); // the spec's own palette leads its family
    assert.ok(house > 0);
    for (let i = 1; i < hues.length; i++) {
      assert.ok(hues[i] > hues[i - 1], `${family} accents ascend at position ${i}`);
    }
  }
});

test('the derived secondary vars key on who painted, not on which theme', () => {
  // They used to be a list of selectors edited a second time per theme, and
  // forgetting left that theme's code blocks near-black. Matching "any theme
  // that is not light or dark" fixed that and broke something else: it claimed
  // an imported spec's own named theme (raised in review of PR #217). The
  // marker review.js sets beside data-theme says the review layer painted it.
  assert.ok(CSS.includes(':root[data-sf-variant] {'), 'keyed on the marker');
  assert.ok(/root\.setAttribute\('data-sf-variant', id\)/.test(JS), 'which review.js sets');
  assert.ok(/removeAttribute\('data-sf-variant'\)/.test(JS),
    'and clears for light and dark, which the spec owns');
});

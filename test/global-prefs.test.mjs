// Unit tests for store-wide UI prefs (lib/global-prefs.mjs) — theme + font, the
// reading settings that apply to every spec.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readGlobalPrefs, writeGlobalPrefs, sanitizeGlobalPrefs } from '../lib/global-prefs.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-gprefs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('readGlobalPrefs is {} before anything is stored', () => {
  assert.deepEqual(readGlobalPrefs(), {});
});

test('writeGlobalPrefs persists theme + font and round-trips', () => {
  assert.deepEqual(writeGlobalPrefs({ theme: 'dark', font: 'lora' }), { theme: 'dark', font: 'lora' });
  assert.deepEqual(readGlobalPrefs(), { theme: 'dark', font: 'lora' });
});

test('sanitize accepts every named theme variant (store-wide)', () => {
  for (const t of ['light', 'dark', 'dracula', 'nord', 'solarized-dark', 'solarized-light', 'github-light', 'gruvbox-light']) {
    assert.equal(sanitizeGlobalPrefs({ theme: t }).theme, t, `${t} is a valid theme`);
  }
  assert.equal('theme' in sanitizeGlobalPrefs({ theme: 'monokai' }), false, 'unknown theme dropped');
});

test('sanitize accepts a named font and drops invalid ones', () => {
  assert.equal(sanitizeGlobalPrefs({ font: 'fraunces' }).font, 'fraunces');
  assert.equal(sanitizeGlobalPrefs({ font: 'default' }).font, 'default');
  assert.equal('font' in sanitizeGlobalPrefs({ font: 'comic-sans' }), false, 'unknown font dropped');
});

test('sanitize drops per-spec + unknown keys', () => {
  assert.deepEqual(sanitizeGlobalPrefs({ width: 9, filter: 'all', fit: true, junk: 1 }), {});
});

// ---- projects: the ordered name list, and which one is selected ----

test('sanitize keeps an ordered project list, deduped and trimmed', () => {
  assert.deepEqual(
    sanitizeGlobalPrefs({ projects: ['  figur  ', 'specforge', 'figur', '', 7, 'figur '] }).projects,
    ['figur', 'specforge'],
  );
});

test('sanitize drops a projects value that is not an array', () => {
  assert.equal('projects' in sanitizeGlobalPrefs({ projects: 'figur' }), false);
});

test('the project list is capped at 200 names, like the collection order', () => {
  const many = Array.from({ length: 250 }, (_, i) => `p${i}`);
  assert.equal(sanitizeGlobalPrefs({ projects: many }).projects.length, 200);
});

test('a project name is capped at 60 characters in the list', () => {
  assert.equal(sanitizeGlobalPrefs({ projects: ['p'.repeat(200)] }).projects[0], 'p'.repeat(60));
});

test('the selection round-trips through its three states', () => {
  // null = All projects, '' = No project, a name = that project.
  assert.equal(writeGlobalPrefs({ project: 'figur' }).project, 'figur');
  assert.equal(readGlobalPrefs().project, 'figur');
  assert.equal(writeGlobalPrefs({ project: '' }).project, '');
  assert.equal(readGlobalPrefs().project, '');
  assert.equal(writeGlobalPrefs({ project: null }).project, null);
  assert.equal(readGlobalPrefs().project, null);
});

test('a selection that is neither a string nor null is dropped', () => {
  assert.equal('project' in sanitizeGlobalPrefs({ project: 7 }), false);
  assert.equal('project' in sanitizeGlobalPrefs({ project: {} }), false);
});

test('a blank selection is the No-project pseudo-project, not All projects', () => {
  // '   ' trims to '', which is a real selection. Conflating it with null would
  // send a click on "No project" to "All projects" instead.
  assert.equal(sanitizeGlobalPrefs({ project: '   ' }).project, '');
});

test('an empty project list is stored, so deleting the last project sticks', () => {
  writeGlobalPrefs({ projects: ['figur'] });
  assert.deepEqual(writeGlobalPrefs({ projects: [] }).projects, []);
  assert.deepEqual(readGlobalPrefs().projects, []);
});

test('projects and collectionOrder are independent lists', () => {
  writeGlobalPrefs({ projects: ['figur'], collectionOrder: ['UI', 'Product'] });
  const p = readGlobalPrefs();
  assert.deepEqual(p.projects, ['figur']);
  assert.deepEqual(p.collectionOrder, ['UI', 'Product']);
});

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

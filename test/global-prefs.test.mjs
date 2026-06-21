// Unit tests for store-wide UI prefs (lib/global-prefs.mjs) — the index theme.

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

test('writeGlobalPrefs persists a valid theme and round-trips', () => {
  assert.deepEqual(writeGlobalPrefs({ theme: 'dark' }), { theme: 'dark' });
  assert.deepEqual(readGlobalPrefs(), { theme: 'dark' });
});

test('sanitize drops unknown keys and invalid themes', () => {
  assert.deepEqual(sanitizeGlobalPrefs({ theme: 'neon', width: 9 }), {});
  assert.deepEqual(sanitizeGlobalPrefs({ theme: 'light' }), { theme: 'light' });
});

// Unit tests for the per-spec UI prefs store (lib/store-prefs.mjs): default-empty
// reads, validated round-trips, partial merge, and that bad/unknown values are
// dropped (the file stays a small trusted shape the client applies blind).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readPrefs, writePrefs, sanitizePrefs } from '../lib/store-prefs.mjs';

let home;
let prevHome;
let id;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-prefs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  id = createSpec({ title: 'A', html: '<h1>A</h1>' });
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('readPrefs returns {} when nothing is stored', () => {
  assert.deepEqual(readPrefs(id), {});
});

test('writePrefs persists and readPrefs round-trips', () => {
  writePrefs(id, { theme: 'light', width: 1200, filter: 'all' });
  assert.deepEqual(readPrefs(id), { theme: 'light', width: 1200, filter: 'all' });
});

test('writePrefs merges a partial patch into existing prefs', () => {
  writePrefs(id, { theme: 'dark', width: 1000 });
  const merged = writePrefs(id, { theme: 'light' });
  assert.deepEqual(merged, { theme: 'light', width: 1000 });
  assert.deepEqual(readPrefs(id), { theme: 'light', width: 1000 });
});

test('sanitize drops unknown keys and invalid enum values', () => {
  assert.deepEqual(sanitizePrefs({ theme: 'neon', filter: 'bogus', junk: 1 }), {});
});

test('sanitize clamps width into [820,1760] and rounds it', () => {
  assert.equal(sanitizePrefs({ width: 100 }).width, 820);
  assert.equal(sanitizePrefs({ width: 99999 }).width, 1760);
  assert.equal(sanitizePrefs({ width: 1199.6 }).width, 1200);
  assert.equal('width' in sanitizePrefs({ width: 'wide' }), false);
});

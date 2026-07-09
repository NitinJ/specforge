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
  writePrefs(id, { width: 1200, filter: 'all' });
  assert.deepEqual(readPrefs(id), { width: 1200, filter: 'all' });
});

test('writePrefs merges a partial patch into existing prefs', () => {
  writePrefs(id, { filter: 'all', width: 1000 });
  const merged = writePrefs(id, { filter: 'open' });
  assert.deepEqual(merged, { filter: 'open', width: 1000 });
  assert.deepEqual(readPrefs(id), { filter: 'open', width: 1000 });
});

test('theme and font are store-wide, not per-spec — sanitizePrefs drops them', () => {
  // They live in global-prefs now; the per-spec store must ignore them so a
  // stray write can never re-introduce a per-spec theme/font.
  assert.deepEqual(sanitizePrefs({ theme: 'dracula', font: 'lora', width: 1200 }), { width: 1200 });
});

test('sanitize drops unknown keys and invalid enum values', () => {
  assert.deepEqual(sanitizePrefs({ theme: 'neon', filter: 'bogus', junk: 1 }), {});
});

test('sanitize keeps the view prefs: fit (boolean) and toc (shown|hidden)', () => {
  assert.equal(sanitizePrefs({ fit: true }).fit, true);
  assert.equal(sanitizePrefs({ fit: false }).fit, false);
  assert.equal('fit' in sanitizePrefs({ fit: 'yes' }), false, 'non-boolean fit dropped');
  assert.equal(sanitizePrefs({ toc: 'hidden' }).toc, 'hidden');
  assert.equal(sanitizePrefs({ toc: 'shown' }).toc, 'shown');
  assert.equal('toc' in sanitizePrefs({ toc: 'sideways' }), false, 'unknown toc value dropped');
});

test('writePrefs round-trips the view options (fit/toc) with the other per-spec prefs', () => {
  writePrefs(id, { width: 1400, fit: true, toc: 'hidden', filter: 'all' });
  assert.deepEqual(readPrefs(id), { width: 1400, fit: true, toc: 'hidden', filter: 'all' });
});

test('sanitize clamps width into [820,1760] and rounds it', () => {
  assert.equal(sanitizePrefs({ width: 100 }).width, 820);
  assert.equal(sanitizePrefs({ width: 99999 }).width, 1760);
  assert.equal(sanitizePrefs({ width: 1199.6 }).width, 1200);
  assert.equal('width' in sanitizePrefs({ width: 'wide' }), false);
});

test('sanitize drops non-number width (null/false/empty), not coercing to 0→820', () => {
  assert.equal('width' in sanitizePrefs({ width: null }), false);
  assert.equal('width' in sanitizePrefs({ width: false }), false);
  assert.equal('width' in sanitizePrefs({ width: '' }), false);
});

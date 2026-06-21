// Unit tests for the organize layer: validation (lib/organize.mjs), the title
// rewrite (spec.mjs#setTitle), and renameSpec (store.mjs) updating meta + HTML.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sanitizeTitle, sanitizeTags, sanitizeCollection } from '../lib/organize.mjs';
import { setTitle } from '../lib/spec.mjs';
import { createSpec, renameSpec, readSpecHtml } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-org-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('sanitizeTitle trims/collapses; non-string → ""', () => {
  assert.equal(sanitizeTitle('  My   Spec\n'), 'My Spec');
  assert.equal(sanitizeTitle(null), '');
});

test('sanitizeTags trims, drops blanks, dedupes case-insensitively', () => {
  assert.deepEqual(sanitizeTags(['  API ', 'api', '', 'Auth', 7]), ['API', 'Auth']);
  assert.deepEqual(sanitizeTags('nope'), []);
});

test('sanitizeCollection → single trimmed name or null', () => {
  assert.equal(sanitizeCollection('  Launch  Q3 '), 'Launch Q3');
  assert.equal(sanitizeCollection('   '), null);
  assert.equal(sanitizeCollection(undefined), null);
});

test('setTitle rewrites the <title> and the first <h1>, escaping', () => {
  const html = '<html><head><title>Old</title></head><body><h1>Old</h1><h1>keep</h1></body></html>';
  const out = setTitle(html, 'New & Shiny');
  assert.match(out, /<title>New &amp; Shiny<\/title>/, '& is HTML-escaped in the title');
  assert.match(out, /<h1>New &amp; Shiny<\/h1>/);
  assert.match(out, /<h1>keep<\/h1>/, 'only the first h1 is rewritten');
});

test('renameSpec updates meta.title and the spec HTML heading', () => {
  const id = createSpec({ title: 'Before', html: '<html><head><title>Before</title></head><body><h1>Before</h1></body></html>' });
  const meta = renameSpec(id, 'After');
  assert.equal(meta.title, 'After');
  assert.equal(readMeta(id).title, 'After');
  const html = readSpecHtml(id);
  assert.match(html, /<h1>After<\/h1>/);
  assert.match(html, /<title>After<\/title>/);
});

test('renameSpec returns null for an unknown spec', () => {
  assert.equal(renameSpec('deadbeef00', 'x'), null);
});

test('a new spec defaults to empty tags and no collection', () => {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const m = readMeta(id);
  assert.deepEqual(m.tags, []);
  assert.equal(m.collection, null);
});

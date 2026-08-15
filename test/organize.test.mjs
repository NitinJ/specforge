// Unit tests for the organize layer: validation (lib/organize.mjs), the title
// rewrite (spec.mjs#setTitle), and renameSpec (store.mjs) updating meta + HTML.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sanitizeTitle, sanitizeTags, sanitizeCollection, sanitizeProject } from '../lib/organize.mjs';
import { setTitle } from '../lib/spec.mjs';
import { createSpec, renameSpec, readSpecHtml } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';

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

test('sanitizeProject → single trimmed name or null', () => {
  assert.equal(sanitizeProject('  figur   design studio '), 'figur design studio');
  assert.equal(sanitizeProject('   '), null);
  assert.equal(sanitizeProject(undefined), null);
  assert.equal(sanitizeProject(null), null);
  assert.equal(sanitizeProject(7), null);
});

test('sanitizeProject caps a name at 60 characters', () => {
  assert.equal(sanitizeProject('p'.repeat(200)), 'p'.repeat(60));
});

test('sanitizeProject collapses newlines and tabs, like a collection name', () => {
  assert.equal(sanitizeProject('a\n\tb'), 'a b');
  // The two levels validate identically; a name legal for one is legal for the other.
  assert.equal(sanitizeProject('  Launch  Q3 '), sanitizeCollection('  Launch  Q3 '));
});

test('setTitle rewrites the <title> and the first <h1>, escaping', () => {
  const html = '<html><head><title>Old</title></head><body><h1>Old</h1><h1>keep</h1></body></html>';
  const out = setTitle(html, 'New & Shiny');
  assert.match(out, /<title>New &amp; Shiny<\/title>/, '& is HTML-escaped in the title');
  assert.match(out, /<h1>New &amp; Shiny<\/h1>/);
  assert.match(out, /<h1>keep<\/h1>/, 'only the first h1 is rewritten');
});

test('setTitle keeps $-tokens literal (no replacement-pattern corruption)', () => {
  const html = '<html><head><title>x</title></head><body><h1>x</h1></body></html>';
  const out = setTitle(html, 'Cost $2/mo');
  assert.match(out, /<h1>Cost \$2\/mo<\/h1>/, '$2 stays literal, not replaced by the captured tag');
  assert.match(out, /<title>Cost \$2\/mo<\/title>/);
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

test('a new spec defaults to empty tags, no collection and no project', () => {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const m = readMeta(id);
  assert.deepEqual(m.tags, []);
  assert.equal(m.collection, null);
  assert.equal(m.project, null);
});

test('a spec written before the project field reads as unfiled, and stays that way', () => {
  const id = createSpec({ title: 'A', html: '<h1>A</h1>' });
  const legacy = readMeta(id);
  delete legacy.project;
  writeMeta(id, legacy);

  // Absent is the same state as null: nothing repairs it, nothing needs to.
  assert.equal(readMeta(id).project, undefined);
  assert.equal(readMeta(id).project || null, null);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { defaultMeta, readMeta, writeMeta, listSpecs } from '../lib/meta.mjs';
import { specDir } from '../lib/store.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-meta-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('defaultMeta has the v2 schema with draft/unattached defaults', () => {
  const m = defaultMeta({ id: 'abc123', title: 'My spec', origin: '/proj' });
  assert.equal(m.id, 'abc123');
  assert.equal(m.title, 'My spec');
  assert.equal(m.status, 'draft');
  assert.equal(m.origin, '/proj');
  assert.equal(m.attachedSession, null);
  assert.equal(m.heartbeat, 0);
  assert.equal(m.type, 'design-impl');
  assert.equal(typeof m.created, 'number');
  assert.equal(typeof m.updated, 'number');
});

test('defaultMeta type: defaults to design-impl, honours valid, rejects unknown', () => {
  assert.equal(defaultMeta({ id: 'a' }).type, 'design-impl');
  assert.equal(defaultMeta({ id: 'a', type: 'research' }).type, 'research');
  assert.equal(defaultMeta({ id: 'a', type: 'bogus' }).type, 'design-impl'); // defensive default
});

test('defaultMeta falls back to Untitled', () => {
  assert.equal(defaultMeta({ id: 'x' }).title, 'Untitled');
});

test('readMeta returns null when no meta exists', () => {
  assert.equal(readMeta('missing'), null);
});

test('writeMeta + readMeta round-trip; updated is bumped', () => {
  const m = defaultMeta({ id: 'r1', title: 'T', origin: null });
  const written = writeMeta('r1', m);
  assert.ok(written.updated >= m.created);
  const back = readMeta('r1');
  assert.equal(back.id, 'r1');
  assert.equal(back.title, 'T');
  assert.equal(back.status, 'draft');
});

test('listSpecs returns meta for every store spec, skipping non-meta dirs', () => {
  writeMeta('s1', defaultMeta({ id: 's1', title: 'One' }));
  writeMeta('s2', defaultMeta({ id: 's2', title: 'Two' }));
  // a dir without meta.json must be ignored
  mkdirSync(specDir('orphan'), { recursive: true });

  const all = listSpecs();
  const ids = all.map((m) => m.id).sort();
  assert.deepEqual(ids, ['s1', 's2']);
});

test('listSpecs returns empty when the store has no specs', () => {
  assert.deepEqual(listSpecs(), []);
});

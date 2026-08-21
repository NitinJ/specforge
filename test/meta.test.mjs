import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  defaultMeta, readMeta, writeMeta, listSpecs, DEFAULT_TYPE, LEGACY_TYPE,
} from '../lib/meta.mjs';
import { specTypes, isSpecType, BUILTIN_SHELL } from '../lib/spec-types.mjs';
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
  assert.equal(m.type, 'general');
  assert.equal(typeof m.created, 'number');
  assert.equal(typeof m.updated, 'number');
});

test('defaultMeta type: defaults to general, honours valid, rejects unknown', () => {
  assert.equal(defaultMeta({ id: 'a' }).type, 'general');
  assert.equal(defaultMeta({ id: 'a', type: 'research' }).type, 'research');
  assert.equal(defaultMeta({ id: 'a', type: 'bogus' }).type, 'general'); // defensive default
});

test('every spec type maps to a known shell', () => {
  // The kind list and the shell map both moved to lib/spec-types.mjs, where the
  // built-in table is one of two sources rather than the only one. What has to
  // stay true is unchanged: every kind names a shell that exists.
  for (const t of specTypes()) assert.ok(['doc', 'impl'].includes(BUILTIN_SHELL[t]), `${t} maps to a shell`);
  assert.ok(isSpecType(DEFAULT_TYPE), 'DEFAULT_TYPE is a valid type');
  assert.equal(DEFAULT_TYPE, 'general', 'a new spec that fits no other type gets the general shell');
  assert.equal(BUILTIN_SHELL.general, 'doc', 'general carries no tracker');
});

test('LEGACY_TYPE keeps untyped pre-existing specs in the shape they were authored in', () => {
  // Untyped specs predate the type field and were all authored as design-impl.
  // Reading them as DEFAULT_TYPE would relabel them general and hide their plan.
  assert.equal(LEGACY_TYPE, 'design-impl');
  assert.ok(isSpecType(LEGACY_TYPE), 'LEGACY_TYPE is a valid type');
  assert.notEqual(LEGACY_TYPE, DEFAULT_TYPE, 'the new-spec default and the legacy fallback are separate');
});

test('meta.mjs no longer exports the kind list', async () => {
  // Removed rather than deprecated (spec 45395008a2, D7): it was a module-level
  // array, so a reader that kept it would validate against six kinds forever
  // and never say so. Gone, a missed reader is an import error.
  const meta = await import('../lib/meta.mjs');
  assert.equal(meta.SPEC_TYPES, undefined);
  assert.equal(meta.TYPE_SHELL, undefined);
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

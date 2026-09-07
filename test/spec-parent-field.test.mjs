// The `parent` field: its default, its absence, and what createSpec does with it.
//
// The claim that carries the most risk here is the one about migration. Every
// meta.json in the store predates this field, and the design says none of them
// needs touching. That is only true if reading one never writes it back, so
// that gets asserted on bytes and mtimes rather than on intent.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { defaultMeta, readMeta, listSpecs } from '../lib/meta.mjs';
import { createSpec } from '../lib/store.mjs';
import { childrenOf, descendantsOf, ancestryOf } from '../lib/spec-tree.mjs';
import { metaPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-parent-');

test('defaultMeta carries parent, defaulting to null', () => {
  const m = defaultMeta({ id: 'abc1234567', title: 'T' });
  assert.equal('parent' in m, true);
  assert.equal(m.parent, null);
});

test('a spec created with no parent is a root', () => {
  const id = createSpec({ title: 'Root', html: '<h1>Root</h1>' });
  assert.equal(readMeta(id).parent, null);
});

test('createSpec records a parent when given one', () => {
  const root = createSpec({ title: 'Root', html: '<h1>Root</h1>' });
  const child = createSpec({ title: 'Child', html: '<h1>Child</h1>', parent: root });
  assert.equal(readMeta(child).parent, root);
  assert.deepEqual(childrenOf(root).map((m) => m.id), [child]);
});

test('createSpec refuses a parent that does not exist', () => {
  assert.throws(
    () => createSpec({ title: 'Orphan', html: '<h1>x</h1>', parent: '0000000000' }),
    /parent/i,
  );
});

test('createSpec refuses a parent id that would escape the store', () => {
  assert.throws(() => createSpec({ title: 'Bad', html: '<h1>x</h1>', parent: '../../etc' }), /spec id/i);
});

// ── Q3: inheritance at creation, independence afterwards ────────────────────

test('a child inherits its parent project and collection when neither is given', () => {
  const root = seedSpec({ title: 'Root', project: 'specforge', collection: 'Store' });
  const child = createSpec({ title: 'Child', html: '<h1>c</h1>', parent: root });
  const m = readMeta(child);
  assert.equal(m.project, 'specforge');
  assert.equal(m.collection, 'Store');
});

test('an explicit project or collection wins over the parent', () => {
  const root = seedSpec({ title: 'Root', project: 'specforge', collection: 'Store' });
  const child = createSpec({
    title: 'Child', html: '<h1>c</h1>', parent: root, project: 'other', collection: 'Elsewhere',
  });
  const m = readMeta(child);
  assert.equal(m.project, 'other');
  assert.equal(m.collection, 'Elsewhere');
});

test('an explicit empty project files the child nowhere, and is not overridden', () => {
  const root = seedSpec({ title: 'Root', project: 'specforge' });
  const child = createSpec({ title: 'Child', html: '<h1>c</h1>', parent: root, project: '' });
  assert.equal(readMeta(child).project, '');
});

test('a root created with no parent inherits nothing', () => {
  seedSpec({ title: 'Elsewhere', project: 'specforge' });
  const id = createSpec({ title: 'Root', html: '<h1>r</h1>' });
  assert.equal(readMeta(id).project, null);
});

// ── I7: reading never writes ────────────────────────────────────────────────

test('reading a meta with no parent key does not rewrite the file', () => {
  const id = seedSpec({ title: 'Legacy', legacy: true });
  const path = metaPath(id);
  const before = { bytes: readFileSync(path), mtime: statSync(path).mtimeMs };

  // A full read pass: every function that touches metas.
  readMeta(id);
  listSpecs();
  childrenOf(id);
  descendantsOf(id);
  ancestryOf(id);

  const after = { bytes: readFileSync(path), mtime: statSync(path).mtimeMs };
  assert.equal(after.bytes.equals(before.bytes), true, 'meta.json bytes changed on read');
  assert.equal(after.mtime, before.mtime, 'meta.json mtime changed on read');
});

test('a meta with no parent key reads as a root', () => {
  const id = seedSpec({ title: 'Legacy', legacy: true });
  assert.equal(readMeta(id).parent, undefined);
  assert.deepEqual(ancestryOf(id), [id]);
  assert.deepEqual(descendantsOf(id), [id]);
});

test('a store of legacy metas has no relations at all', () => {
  const a = seedSpec({ title: 'A', legacy: true });
  const b = seedSpec({ title: 'B', legacy: true });
  assert.deepEqual(childrenOf(a), []);
  assert.deepEqual(childrenOf(b), []);
  assert.equal(listSpecs().length, 2);
});

// The fixtures every child-spec stage tests against.
//
// These are self-tests: they assert the harness builds what it claims, because a
// fixture that silently writes the wrong `parent` turns a later stage's failure
// into a mystery about the code under test.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape, SHAPES } from './helpers/spec-tree-fixtures.mjs';
import { readMeta, listSpecs } from '../lib/meta.mjs';
import { metaPath, specHtmlPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-treefix-');

test('seedSpec writes a real spec directory', () => {
  const id = seedSpec({ title: 'Root', type: 'design', status: 'review' });
  assert.ok(existsSync(metaPath(id)));
  assert.ok(existsSync(specHtmlPath(id)));
  const m = readMeta(id);
  assert.equal(m.title, 'Root');
  assert.equal(m.type, 'design');
  assert.equal(m.status, 'review');
});

test('seedSpec records the parent it was given', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  assert.equal(readMeta(child).parent, root);
});

test('seedSpec leaves parent absent when none is given', () => {
  const id = seedSpec({ title: 'Lonely' });
  const raw = JSON.parse(readFileSync(metaPath(id), 'utf8'));
  assert.ok(!('parent' in raw) || raw.parent === null);
});

test('seedSpec can write a meta with no parent key at all', () => {
  // The pre-migration shape: what all 192 existing specs look like on disk.
  const id = seedSpec({ title: 'Legacy', legacy: true });
  const raw = JSON.parse(readFileSync(metaPath(id), 'utf8'));
  assert.equal('parent' in raw, false);
});

test('every named shape builds and reports its own structure', () => {
  for (const name of Object.keys(SHAPES)) {
    const built = buildShape(name);
    assert.ok(built.ids.length > 0, `${name} produced no specs`);
    for (const id of built.ids) assert.ok(existsSync(metaPath(id)), `${name}: ${id} missing`);
  }
});

test('flat has no relations', () => {
  const { ids } = buildShape('flat');
  for (const id of ids) assert.equal(readMeta(id).parent ?? null, null);
});

test('chain5 is five deep, each pointing at the one above', () => {
  const { ids } = buildShape('chain5');
  assert.equal(ids.length, 5);
  assert.equal(readMeta(ids[0]).parent ?? null, null);
  for (let i = 1; i < 5; i++) assert.equal(readMeta(ids[i]).parent, ids[i - 1]);
});

test('fan is one parent with four children', () => {
  const { root, children } = buildShape('fan');
  assert.equal(children.length, 4);
  for (const c of children) assert.equal(readMeta(c).parent, root);
});

test('dangling points at a spec that does not exist', () => {
  const { child, missing } = buildShape('dangling');
  assert.equal(readMeta(child).parent, missing);
  assert.equal(readMeta(missing), null);
});

test('cyclic writes a cycle no API would accept', () => {
  const { ids } = buildShape('cyclic');
  assert.equal(readMeta(ids[0]).parent, ids[ids.length - 1]);
  for (let i = 1; i < ids.length; i++) assert.equal(readMeta(ids[i]).parent, ids[i - 1]);
});

test('hostile-css child carries rules that would break a host document', () => {
  const { child } = buildShape('hostile-css');
  const html = readFileSync(specHtmlPath(child), 'utf8');
  // Bare element selectors with !important: harmless in their own document,
  // destructive when injected into another one. This is the fixture that makes
  // the iframe boundary testable rather than assumed.
  assert.match(html, /body\s*\{[^}]*!important/);
  assert.match(html, /p\s*\{[^}]*!important/);
});

test('shapes are built into the live store, so listSpecs sees them', () => {
  const { ids } = buildShape('fan');
  const listed = listSpecs().map((m) => m.id).sort();
  assert.deepEqual(listed, [...ids].sort());
});

test('seedSpec does not rewrite a meta it did not create', () => {
  const id = seedSpec({ title: 'Untouched' });
  const before = statSync(metaPath(id)).mtimeMs;
  seedSpec({ title: 'Another' });
  assert.equal(statSync(metaPath(id)).mtimeMs, before);
});

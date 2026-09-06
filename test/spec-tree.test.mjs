// The one module that walks the parent edge.
//
// Every consumer asks it the same four questions, so its edge cases are pinned
// here rather than through six HTTP routes. The two that matter most are the
// ones no API can produce: a `parent` naming a spec that is gone, and a cycle.
// Both are reachable by editing a meta.json by hand, so both have to terminate.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import {
  childrenOf, descendantsOf, ancestryOf, wouldCycle,
} from '../lib/spec-tree.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-tree-');

// ── childrenOf ──────────────────────────────────────────────────────────────

test('childrenOf returns the specs naming this one as parent', () => {
  const { root, children } = buildShape('fan');
  const got = childrenOf(root).map((m) => m.id);
  assert.deepEqual(got.sort(), [...children].sort());
});

test('childrenOf returns one level, not the whole subtree', () => {
  const { ids } = buildShape('chain5');
  assert.deepEqual(childrenOf(ids[0]).map((m) => m.id), [ids[1]]);
});

test('childrenOf sorts by creation order', () => {
  const root = seedSpec({ title: 'Root' });
  const first = seedSpec({ title: 'First', parent: root, created: 1000 });
  const second = seedSpec({ title: 'Second', parent: root, created: 2000 });
  assert.deepEqual(childrenOf(root).map((m) => m.id), [first, second]);
});

test('childrenOf is stable when two children were created in the same millisecond', () => {
  const root = seedSpec({ title: 'Root' });
  seedSpec({ title: 'A', parent: root, created: 1000 });
  seedSpec({ title: 'B', parent: root, created: 1000 });
  // Ties break on id, so the order is arbitrary but must not change between
  // reads: a sidebar that reshuffles on refresh is worse than one in any order.
  const once = childrenOf(root).map((m) => m.id);
  assert.deepEqual(childrenOf(root).map((m) => m.id), once);
  assert.equal(once.length, 2);
});

test('childrenOf is empty for a leaf and for an unknown id', () => {
  const id = seedSpec({ title: 'Leaf' });
  assert.deepEqual(childrenOf(id), []);
  assert.deepEqual(childrenOf('0000000000'), []);
});

test('childrenOf refuses an id that would escape the store', () => {
  assert.throws(() => childrenOf('../../etc'), /spec id/i);
});

// ── descendantsOf ───────────────────────────────────────────────────────────

test('descendantsOf returns the root first, then everything below it', () => {
  const { ids } = buildShape('chain5');
  assert.deepEqual(descendantsOf(ids[0]), ids);
});

test('descendantsOf covers a fan', () => {
  const { root, children, ids } = buildShape('fan');
  const got = descendantsOf(root);
  assert.equal(got[0], root);
  assert.deepEqual([...got].sort(), [...ids].sort());
  for (const c of children) assert.ok(got.includes(c));
});

test('descendantsOf from a middle spec returns only that branch', () => {
  const { ids } = buildShape('chain5');
  assert.deepEqual(descendantsOf(ids[2]), [ids[2], ids[3], ids[4]]);
});

test('descendantsOf lists each spec once', () => {
  const { ids } = buildShape('fan');
  const got = descendantsOf(ids[0]);
  assert.equal(new Set(got).size, got.length);
});

test('descendantsOf of an unknown id is empty, not a throw', () => {
  assert.deepEqual(descendantsOf('0000000000'), []);
});

test('descendantsOf terminates on a cycle written by hand', () => {
  const { ids } = buildShape('cyclic');
  const got = descendantsOf(ids[0]);
  assert.equal(new Set(got).size, got.length);
  assert.ok(got.includes(ids[0]));
});

test('descendantsOf ignores a child pointing at a missing spec', () => {
  const { child, missing } = buildShape('dangling');
  assert.deepEqual(descendantsOf(missing), []);
  assert.deepEqual(descendantsOf(child), [child]);
});

// ── ancestryOf ──────────────────────────────────────────────────────────────

test('ancestryOf walks up to the root, root first', () => {
  const { ids } = buildShape('chain5');
  assert.deepEqual(ancestryOf(ids[4]), ids);
});

test('ancestryOf of a root is just itself', () => {
  const id = seedSpec({ title: 'Alone' });
  assert.deepEqual(ancestryOf(id), [id]);
});

test('ancestryOf stops at a parent that does not exist', () => {
  const { child } = buildShape('dangling');
  assert.deepEqual(ancestryOf(child), [child]);
});

test('ancestryOf terminates on a cycle', () => {
  const { ids } = buildShape('cyclic');
  const got = ancestryOf(ids[0]);
  assert.equal(new Set(got).size, got.length);
});

test('ancestryOf of an unknown id is empty', () => {
  assert.deepEqual(ancestryOf('0000000000'), []);
});

// ── wouldCycle ──────────────────────────────────────────────────────────────

test('wouldCycle is false for null: detaching can never make a cycle', () => {
  const { ids } = buildShape('chain5');
  assert.equal(wouldCycle(ids[2], null), false);
});

test('wouldCycle is true for self', () => {
  const id = seedSpec({ title: 'Self' });
  assert.equal(wouldCycle(id, id), true);
});

test('wouldCycle is true for a direct child', () => {
  const { root, children } = buildShape('fan');
  assert.equal(wouldCycle(root, children[0]), true);
});

test('wouldCycle is true for a deep descendant', () => {
  const { ids } = buildShape('chain5');
  assert.equal(wouldCycle(ids[0], ids[4]), true);
});

test('wouldCycle is false for an unrelated spec', () => {
  const { ids } = buildShape('chain5');
  const other = seedSpec({ title: 'Elsewhere' });
  assert.equal(wouldCycle(ids[4], other), false);
});

test('wouldCycle is false for the spec that is already the parent', () => {
  const { ids } = buildShape('chain5');
  // Re-setting the same parent is a no-op, not a cycle.
  assert.equal(wouldCycle(ids[1], ids[0]), false);
});

test('wouldCycle allows moving a subtree under an unrelated spec', () => {
  const { ids } = buildShape('chain5');
  const other = seedSpec({ title: 'New home' });
  assert.equal(wouldCycle(ids[2], other), false);
});

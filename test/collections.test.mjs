// Collection grouping and rank (lib/collections.mjs) — the rule the home page
// rail, its project sections and the public project page must not disagree
// about.
//
// A name ranks by its most recently active member anywhere in the store: the
// newest of `created`, `updated` and the newest comment on a spec carrying it.
// Ties fall to A–Z and Uncollected is always last. Nothing here reads the
// store — the comment times ride in as data — so every timestamp is pinned
// rather than hoped for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupByCollection, collectionRecency } from '../lib/collections.mjs';

const spec = (id, collection, at) => ({ id, collection, created: at, updated: at });
const keys = (specs, recency = collectionRecency(specs)) =>
  groupByCollection(specs, recency).order.map((g) => g.key);

test('named collections come out most recently active first', () => {
  const a = spec('a', 'Alpha', 1000);
  const b = spec('b', 'Beta', 2000);
  assert.deepEqual(keys([a, b]), ['Beta', 'Alpha']);
});

test('a name is as recent as its most recently active member', () => {
  const a1 = spec('a1', 'Alpha', 1);
  const a2 = spec('a2', 'Alpha', 2);
  const b = spec('b', 'Beta', 3);
  assert.deepEqual(keys([a1, a2, b]), ['Beta', 'Alpha'], 'the older members do not drag the name down');
  assert.deepEqual(keys([a1, a2, b, spec('a3', 'Alpha', 4)]), ['Alpha', 'Beta'], 'one fresh member lifts it');
});

test('created and updated both count as activity', () => {
  const b = spec('b', 'Beta', 4000);
  const updated = { id: 'u', collection: 'Alpha', created: 1, updated: 5000 };
  assert.deepEqual(keys([updated, b]), ['Alpha', 'Beta'], 'updated is activity');
  const created = { id: 'c', collection: 'Alpha', created: 5000, updated: 1 };
  assert.deepEqual(keys([created, b]), ['Alpha', 'Beta'], 'and so is created');
});

test('a new comment counts as activity', () => {
  const a = spec('a', 'Alpha', 1000);
  const b = spec('b', 'Beta', 2000);
  assert.deepEqual(keys([a, b]), ['Beta', 'Alpha']);
  const commented = new Map([['a', 3000]]);
  assert.deepEqual(keys([a, b], collectionRecency([a, b], commented)), ['Alpha', 'Beta'],
    'the commented spec lifts its name');
});

test('a name ranks by its freshest member anywhere — even outside the grouped scope', () => {
  // The rail and the project bodies group different scopes. A name shared
  // across projects must keep one rank in all of them, or the navigation and
  // the sections it shows read in different orders.
  const here = [spec('a', 'Alpha', 1000), spec('b', 'Beta', 2000)];
  const elsewhere = spec('x', 'Alpha', 3000); // filed in another project
  const store = [...here, elsewhere];
  const recency = collectionRecency(store);
  assert.deepEqual(keys(here, recency), ['Alpha', 'Beta'],
    'Alpha leads here on activity this scope does not even show');
  assert.deepEqual(keys(store, recency), ['Alpha', 'Beta'], 'and leads everywhere else too');
});

test('a tie falls back to alphabetical', () => {
  const z = spec('z', 'Zulu', 5);
  const a = spec('a', 'Alpha', 5);
  assert.deepEqual(keys([z, a]), ['Alpha', 'Zulu']);
});

test('Uncollected is last, only when something is in it, and never ranked', () => {
  const loose = spec('l', '', 99999);
  const a = spec('a', 'Alpha', 1);
  assert.deepEqual(keys([loose, a]), ['Alpha', ''], 'not even the freshest spec can lift it');
  assert.deepEqual(keys([a]), ['Alpha'], 'absent when nothing is in it');
  assert.deepEqual(groupByCollection([loose, a]).named, ['Alpha'], 'it is not a name anyone can place');
  assert.equal(collectionRecency([loose, a]).has(''), false, 'and it has no rank to place');
});

test('the grouping reorders groups, never the specs inside one', () => {
  const first = spec('1', 'Alpha', 1);
  const second = spec('2', 'Alpha', 2);
  const [{ specs }] = groupByCollection([first, second]).order;
  assert.deepEqual(specs.map((m) => m.id), ['1', '2'], 'the rows keep the order the caller gave');
});

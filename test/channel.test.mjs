// Unit tests for the in-memory long-poll channel (lib/channel.mjs): publish
// wakes parked waiters, waitForBatch parks until publish or timeout. Each test
// uses a distinct specId since the registry is process-global module state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish, waitForBatch, waiterCount } from '../lib/channel.mjs';

test('publish delivers the batch to a parked waiter', async () => {
  const p = waitForBatch('spec-deliver', 1000);
  const n = publish('spec-deliver', { batchId: 'b1' });
  assert.equal(n, 1, 'one waiter notified');
  assert.equal((await p).batchId, 'b1');
});

test('waitForBatch resolves null after the timeout', async () => {
  assert.equal(await waitForBatch('spec-timeout', 10), null);
});

test('publish with no waiter is a safe no-op', () => {
  assert.equal(publish('nobody-home', { batchId: 'x' }), 0);
});

test('publish fans out to every parked waiter for the spec', async () => {
  const a = waitForBatch('spec-fan', 1000);
  const b = waitForBatch('spec-fan', 1000);
  const n = publish('spec-fan', { batchId: 'bf' });
  assert.equal(n, 2);
  assert.deepEqual([(await a).batchId, (await b).batchId], ['bf', 'bf']);
});

test('waiterCount reflects parked then cleared waiters', async () => {
  assert.equal(waiterCount('spec-count'), 0);
  const p = waitForBatch('spec-count', 1000);
  assert.equal(waiterCount('spec-count'), 1);
  publish('spec-count', { batchId: 'bc' });
  await p;
  assert.equal(waiterCount('spec-count'), 0);
});

test('a waiter for one spec is not woken by another spec', async () => {
  // Park with a short timeout and await it: a publish to a different spec must
  // not deliver, so it can only resolve via the timeout (null).
  const p = waitForBatch('spec-isolated', 40);
  publish('spec-other', { batchId: 'b' });
  assert.equal(await p, null, 'cross-spec publish must not deliver; resolves via timeout');
});

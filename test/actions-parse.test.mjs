// Reading actions back out of a comment body.
//
// The comment is the whole mechanism, so this is the seam where the browser's
// half meets the agent's. It is built on mentionNames() rather than a fresh
// regex, which buys the one property that matters most here: a mention inside
// code is quotation, not a request. A spec that documents `@agent @visualize`
// must not queue work against itself, and this file is written in a repo whose
// PR comments quote exactly that string.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, actionIdsIn } from '../lib/actions/parse.mjs';

test('a bare action is read back', () => {
  assert.deepEqual(actionIdsIn('@agent @visualize'), ['visualize']);
});

test('typed text after the action is left alone', () => {
  // The composer seeds `@visualize ` and you type onto the end. What you typed
  // is the qualifier, and it is the agent's to read, not this function's.
  assert.deepEqual(
    actionIdsIn('@agent @help_me_decide please weigh the migration cost'),
    ['help_me_decide'],
  );
});

test('two actions in one comment come back in the order they were written', () => {
  assert.deepEqual(actionIdsIn('@agent @visualize @go_deeper'), ['visualize', 'go_deeper']);
});

test('the same action twice is one action', () => {
  assert.deepEqual(actionIdsIn('@agent @tighten and also @tighten'), ['tighten']);
});

test('a comment with no action has none', () => {
  assert.deepEqual(actionIdsIn('@agent this paragraph contradicts §4'), []);
  assert.deepEqual(actionIdsIn(''), []);
  assert.deepEqual(actionIdsIn(null), []);
});

test('@agent itself is not an action', () => {
  // It is addressing, and it is already what put the comment in the batch.
  assert.deepEqual(actionIdsIn('@agent'), []);
});

test('a person is not an action', () => {
  assert.deepEqual(actionIdsIn('@agent @lavee does this still hold?'), []);
});

test('an action inside code is quotation, not a request', () => {
  // The case this whole module is built on mentionNames() for. Both forms of
  // code, because a spec discusses its own syntax in both.
  assert.deepEqual(actionIdsIn('@agent the menu writes `@visualize` into the box'), []);
  assert.deepEqual(actionIdsIn('@agent\n```\n@agent @go_deeper\n```\nwhat do you think?'), []);
});

test('parseActions hands back the whole record, so the caller gets the instruction', () => {
  const [a] = parseActions('@agent @restructure');
  assert.equal(a.id, 'restructure');
  assert.equal(a.kind, 'in-place');
  assert.ok(a.instruction.length > 40, 'the standing instruction rides along');
});

test('an action that needs a detail says so, and whether one was given', () => {
  // Both of these are the same action. The difference is whether the reader
  // typed the fact only they have, and the agent has to ask when they did not.
  const bare = parseActions('@agent @verify_against_code');
  assert.equal(bare[0].needsDetail, true);
  assert.equal(bare[0].detail, '', 'nothing was added');

  const given = parseActions('@agent @verify_against_code the retry limit is 3, see queue.mjs');
  assert.equal(given[0].detail, 'the retry limit is 3, see queue.mjs');
});

test('the detail is what is left after the mentions are taken out', () => {
  const [a] = parseActions('@agent @fix_the_naming call it a garment, not a product');
  assert.equal(a.detail, 'call it a garment, not a product');
});

test('an action with nothing but mentions has an empty detail', () => {
  const [a] = parseActions('@agent @visualize @go_deeper');
  assert.equal(a.detail, '');
});

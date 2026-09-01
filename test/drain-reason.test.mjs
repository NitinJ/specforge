// The text that wakes the session, which is the one message the agent is
// certain to read.
//
// It used to say "amend the spec.html per the comments" unconditionally, and
// that is exactly what four aside actions did instead of writing an aside. The
// most authoritative instruction in the flow was telling the agent to do the
// wrong thing, and no amount of prose in SKILL.md was going to outrank it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewReason } from '../lib/store-drain.mjs';

const batch = (over = {}) => ({
  batchId: 'b_1', specId: 'sp1', title: 'A spec', threadIds: ['th_1'], ...over,
});

test('an ordinary batch still says to amend the spec', () => {
  const out = reviewReason([batch()]);
  assert.match(out, /amend the spec/i);
  assert.match(out, /specforge:review-spec/);
});

test('the same reason under Pi names the bare skill', () => {
  const out = reviewReason([batch()], { SPECFORGE_SESSION_ID: 'pi-1' });
  assert.match(out, /(^|\s)review-spec/);
  assert.doesNotMatch(out, /specforge:/);
});

test('a batch carrying an action says the actions decide what happens', () => {
  // Named, so the agent knows before it starts that "amend the spec" is not the
  // whole story for this batch.
  const out = reviewReason([batch({ actions: ['visualize'] })]);
  assert.match(out, /@visualize/);
  assert.match(out, /actions/i);
});

test('a batch carrying an aside action is told not to edit the section', () => {
  const out = reviewReason([batch({ actions: ['visualize'] })]);
  assert.match(out, /aside/i);
  assert.match(out, /[Dd]o not edit/);
});

test('the unconditional "amend the spec" is qualified once an action is present', () => {
  // The defect in one line: the wake-up text and the action instruction said
  // opposite things, and this text is the one that wins.
  const plain = reviewReason([batch()]);
  const withAction = reviewReason([batch({ actions: ['go_deeper'] })]);
  assert.equal(/unless/i.test(plain), false);
  assert.match(withAction, /unless|except|rather than/i);
});

test('an in-place action does not attract the aside warning', () => {
  const out = reviewReason([batch({ actions: ['tighten'] })]);
  assert.match(out, /@tighten/);
  assert.equal(/[Dd]o not edit the section/.test(out), false);
});

test('an unknown action id is ignored rather than announced', () => {
  const out = reviewReason([batch({ actions: ['visualise'] })]);
  assert.equal(/@visualise/.test(out), false);
});

test('the watcher re-arm is still there', () => {
  assert.match(reviewReason([batch()]), /wait-batch/);
});

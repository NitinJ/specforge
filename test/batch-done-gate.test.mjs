// batch-done refuses while an aside action has produced no aside.
//
// Defence in depth, not the primary mechanism: the primary fix is that the
// instruction and the command now ride on the thread. This is what turns the
// failure from silent into loud, because the way this broke four times was that
// nothing anywhere noticed. The agent edited the spec, replied as though it had
// done the work, and closed the batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asideGaps } from '../lib/actions/aside-gaps.mjs';

const thread = (body, over = {}) => ({
  id: 'th_1',
  anchor: { block: { sectionPath: ['object'], bid: 'b1', ...over } },
  comments: [{ kind: 'human', body }],
});

const SPEC_WITHOUT = '<section id="object"><h2>Object</h2><p>Prose.</p></section>';
const SPEC_WITH = SPEC_WITHOUT
  + '<section id="object-aside-1" data-sf-aside="object" data-sf-thread="th_1" data-sf-action="visualize">'
  + '<h3>A</h3><p>b</p></section>';

test('an aside action with no aside is a gap', () => {
  const gaps = asideGaps([thread('@agent @visualize')], SPEC_WITHOUT, { specId: 'sp1', cli: '/cli.mjs' });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].action, 'visualize');
  assert.equal(gaps[0].section, 'object');
  assert.match(gaps[0].run, /--section object --block b1 --thread th_1 --action visualize/);
});

test('an aside action with its aside is not', () => {
  assert.deepEqual(asideGaps([thread('@agent @visualize')], SPEC_WITH, { specId: 'sp1', cli: '/cli.mjs' }), []);
});

test('an aside answering a different thread does not satisfy this one', () => {
  // The hole a section-plus-action check leaves open: ask @visualize on §object
  // today and last week's §object Visualize aside closes the batch with no new
  // draft written. The thread id is what distinguishes one request from the
  // one before it.
  const again = { ...thread('@agent @visualize'), id: 'th_2' };
  const gaps = asideGaps([again], SPEC_WITH, { specId: 'sp1', cli: '/cli.mjs' });
  assert.equal(gaps.length, 1, 'a fresh request needs a fresh draft');
  assert.match(gaps[0].run, /--thread th_2/);
});

test('one draft does not answer two actions in the same comment', () => {
  // `@agent @visualize @go_deeper` is one thread and two requests. Keyed on the
  // thread alone, the Visualize draft would close the batch and Go deeper would
  // never be written.
  const gaps = asideGaps([thread('@agent @visualize @go_deeper')], SPEC_WITH, { specId: 'sp1', cli: '/cli.mjs' });
  assert.deepEqual(gaps.map((g) => g.action), ['go_deeper']);
});

test('a later request on an answered thread still needs its own draft', () => {
  // A thread accumulates across batches: Visualize last round, Go deeper this
  // one. The old draft is on the right thread and answers the wrong ask.
  const later = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: '@agent @visualize', batchId: 'b_1' },
      { kind: 'human', body: '@agent @go_deeper', batchId: 'b_2' },
    ],
  };
  const gaps = asideGaps([later], SPEC_WITH, {
    specId: 'sp1', cli: '/cli.mjs', batchIds: new Set(['b_2']),
  });
  assert.deepEqual(gaps.map((g) => g.action), ['go_deeper']);
});

test('an aside with no thread attribution satisfies nothing', () => {
  // Hand-written rather than produced by the command. Strict on purpose: the
  // alternative reopens the hole above, and --force is the way through.
  const untagged = SPEC_WITHOUT
    + '<section id="object-aside-1" data-sf-aside="object" data-sf-action="visualize"><h3>A</h3><p>b</p></section>';
  assert.equal(asideGaps([thread('@agent @visualize')], untagged, { specId: 'sp1', cli: '/cli.mjs' }).length, 1);
});

test('an in-place action is never a gap', () => {
  assert.deepEqual(asideGaps([thread('@agent @tighten')], SPEC_WITHOUT, { specId: 'sp1', cli: '/cli.mjs' }), []);
});

test('a thread with no action is never a gap', () => {
  assert.deepEqual(asideGaps([thread('@agent tighten this up')], SPEC_WITHOUT, { specId: 'sp1', cli: '/cli.mjs' }), []);
});

test('a thread that resolves to no section is not held against the agent', () => {
  // There is nowhere to place an aside, so `next` told it to reply saying so.
  // Blocking batch-done on that would be a dead end.
  const orphan = thread('@agent @visualize', { sectionPath: [] });
  assert.deepEqual(asideGaps([orphan], SPEC_WITHOUT, { specId: 'sp1', cli: '/cli.mjs' }), []);
});

test('two missing asides are two gaps, each with its own command', () => {
  const gaps = asideGaps(
    [thread('@agent @visualize'), { ...thread('@agent @go_deeper'), id: 'th_2' }],
    SPEC_WITHOUT,
    { specId: 'sp1', cli: '/cli.mjs' },
  );
  assert.deepEqual(gaps.map((g) => g.action), ['visualize', 'go_deeper']);
  assert.match(gaps[1].run, /--action go_deeper/);
});

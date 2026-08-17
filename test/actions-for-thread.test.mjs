// Resolving a thread's actions into something the agent cannot miss.
//
// The feature failed four times out of four for one reason: the expansion was a
// lookup the agent had to decide to perform. `specforge comments` handed back
// `"@agent @visualize"` and nothing else, so the token arrived reading like
// ordinary English, with the instruction and the command it needs living in a
// section of a skill file it had no reason to open.
//
// This is the push that replaces that pull. Everything an agent needs to run an
// action correctly arrives inline on the thread it is already reading.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsForThread } from '../lib/actions/for-thread.mjs';

const thread = (body, over = {}) => ({
  id: 'th_1',
  anchor: { block: { tag: 'P', text: 'A paragraph.', sectionPath: ['object'], bid: 'b212', ...over } },
  comments: [{ kind: 'human', author: 'nitin', body }],
});

const CLI = '/plugin/lib/specforge-cli.mjs';
const resolve = (t, specId = 'sp1') => actionsForThread(t, { specId, cli: CLI });

test('a thread with no action resolves to nothing', () => {
  assert.deepEqual(resolve(thread('@agent this contradicts §4')), []);
});

test('an aside action arrives with its instruction, not just its name', () => {
  const [a] = resolve(thread('@agent @visualize'));
  assert.equal(a.id, 'visualize');
  assert.equal(a.kind, 'aside');
  assert.match(a.instruction, /Choose the form this content actually wants/);
});

test('an aside action arrives with the command already filled in', () => {
  // The whole point. Not "run specforge aside with the right arguments" but the
  // arguments, from this thread's own anchor.
  const [a] = resolve(thread('@agent @visualize'));
  assert.match(a.run, /aside sp1/);
  assert.match(a.run, /--section object/);
  assert.match(a.run, /--block b212/);
  assert.match(a.run, /--action visualize/);
  assert.match(a.run, /--file/);
  assert.equal(a.run.includes(CLI), true, 'the real CLI path, not a placeholder');
});

test('it says in words that the section is not to be edited', () => {
  // The wake-up text says "amend the spec.html per the comments", and that is
  // the instruction the agent is certain to read. This is what contradicts it,
  // in the same breath as the action it applies to.
  const [a] = resolve(thread('@agent @go_deeper'));
  assert.match(a.next, /[Dd]o not edit/);
  assert.match(a.next, /aside/);
});

test('an in-place action names the section it may edit', () => {
  const [a] = resolve(thread('@agent @tighten'));
  assert.equal(a.kind, 'in-place');
  assert.equal(a.run, null, 'nothing to run: the agent edits the spec');
  assert.match(a.next, /object/, 'and it is told which section');
});

test('a spec-wide action says the scope is the document', () => {
  const [a] = resolve(thread('@agent @consistency_pass'));
  assert.equal(a.scope, 'global');
  assert.match(a.next, /whole spec|whole document/i);
  assert.equal(a.next.includes('object'), false, 'not the section the comment sat on');
});

test('an action needing a detail carries what was typed, and says when it is missing', () => {
  const bare = resolve(thread('@agent @verify_against_code'))[0];
  assert.equal(bare.detail, '');
  assert.match(bare.next, /ask/i, 'told to ask rather than guess');

  const given = resolve(thread('@agent @verify_against_code the retry limit is 3, see queue.mjs'))[0];
  assert.equal(given.detail, 'the retry limit is 3, see queue.mjs');
  assert.equal(/ask/i.test(given.next), false, 'and not told to ask when it was given one');
});

test('a thread with no bid still resolves, without a --block', () => {
  // No registry, or a block that has since gone. The aside is still writable and
  // its marker falls back to the section.
  const [a] = resolve(thread('@agent @visualize', { bid: undefined }));
  assert.match(a.run, /--section object/);
  assert.equal(/--block/.test(a.run), false);
});

test('a thread with no section is refused rather than given a broken command', () => {
  // An aside has to be placed after a section. Without one there is nothing to
  // place it after, and a command that would fail is worse than a sentence
  // saying why.
  const [a] = resolve(thread('@agent @visualize', { sectionPath: [] }));
  assert.equal(a.run, null);
  assert.match(a.next, /section/i);
});

test('two actions in one comment each resolve', () => {
  const out = resolve(thread('@agent @visualize @go_deeper on the retry path'));
  assert.deepEqual(out.map((a) => a.id), ['visualize', 'go_deeper']);
  assert.equal(out[0].detail, 'on the retry path', 'the qualifier serves both');
  assert.equal(out[1].detail, 'on the retry path');
});

test('only the human comments are read', () => {
  // An agent reply quoting an action it just ran must not queue it again.
  const t = thread('@agent this is fine');
  t.comments.push({ kind: 'agent', author: 'claude', body: 'Ran @visualize as asked.' });
  assert.deepEqual(resolve(t), []);
});

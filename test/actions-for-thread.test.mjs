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

test('an aside command names the thread it answers', () => {
  // Without it, batch-done cannot tell a new request from one already answered:
  // an aside written last week on the same section satisfies today's ask.
  const [a] = resolve(thread('@agent @visualize'));
  assert.match(a.run, /--thread th_1/);
});

test('only the batch being answered is resolved', () => {
  // A thread accumulates. Monday's @visualize was answered; Tuesday's reply is
  // the live request. Reading the whole thread would replay Monday's, announce
  // work already done, and have batch-done demand a second draft for it.
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: '@agent @visualize', batchId: 'b_mon' },
      { kind: 'agent', body: 'Drafted it.' },
      { kind: 'human', body: '@agent the arrow is backwards', batchId: 'b_tue' },
    ],
  };
  const live = actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_tue']) });
  assert.deepEqual(live, [], 'Tuesday asks for no action');

  const monday = actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_mon']) });
  assert.deepEqual(monday.map((a) => a.id), ['visualize']);

  const unscoped = actionsForThread(t, { specId: 'sp1', cli: CLI });
  assert.deepEqual(unscoped.map((a) => a.id), ['visualize'], 'no batch in hand reads the whole thread');
});

test('a comment never submitted is not a live request', () => {
  // Typed in the browser and not yet sent. It carries no batchId, so scoping
  // leaves it out; the agent has not been asked for it yet.
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [{ kind: 'human', body: '@agent @visualize' }],
  };
  assert.deepEqual(actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_1']) }), []);
});

test('each action says which batch asked for it', () => {
  // Two batches can be pending at once. Without attribution, an action from the
  // second is delivered as part of the first, done there, and then demanded
  // again when the second comes round.
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: '@agent @visualize', batchId: 'b_1' },
      { kind: 'human', body: '@agent @go_deeper', batchId: 'b_2' },
    ],
  };
  const both = actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_1', 'b_2']) });
  assert.deepEqual(both.map((a) => [a.id, a.batchId]), [['visualize', 'b_1'], ['go_deeper', 'b_2']]);
});

test('the same action in two pending batches is two requests', () => {
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: '@agent @visualize', batchId: 'b_1' },
      { kind: 'human', body: '@agent @visualize again, as a table', batchId: 'b_2' },
    ],
  };
  const out = actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_1', 'b_2']) });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.batchId), ['b_1', 'b_2']);
  assert.equal(out[1].detail, 'again, as a table', 'and each keeps its own qualifier');
});

test('the same action twice inside one batch is one request', () => {
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: '@agent @visualize', batchId: 'b_1' },
      { kind: 'human', body: '@agent @visualize', batchId: 'b_1' },
    ],
  };
  assert.equal(actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_1']) }).length, 1);
});

test('a qualifier belongs to its own comment, not to the whole thread', () => {
  // Joining the thread into one body mixed Monday's words into Tuesday's action.
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object'], bid: 'b1' } },
    comments: [
      { kind: 'human', body: 'this section is confusing', batchId: 'b_1' },
      { kind: 'human', body: '@agent @visualize the retry path', batchId: 'b_1' },
    ],
  };
  const [a] = actionsForThread(t, { specId: 'sp1', cli: CLI, batchIds: new Set(['b_1']) });
  assert.equal(a.detail, 'the retry path');
});

test('an import arrives resolved against the aside it answers', () => {
  // The one action whose instruction cannot be written in advance: what it
  // merges, where, and whether it replaces the section all come from the aside.
  const html = '<section id="object"><h2>O</h2><p>p</p></section>'
    + '<section id="object-aside-1" data-sf-aside="object" data-sf-block="b4" data-sf-action="visualize">'
    + '<h3>Aside: Visualize</h3><p>A diagram.</p></section>';
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object-aside-1'], bid: 'b9' } },
    comments: [{ kind: 'human', body: '@agent @import' }],
  };
  const [a] = actionsForThread(t, { specId: 'sp1', cli: CLI, html });
  assert.equal(a.target.section, 'object', 'the section named in data-sf-aside');
  assert.match(a.target.guidance, /supersedes/, "Visualize's own import guidance");
  assert.match(a.next, /section `object`/);
  assert.match(a.next, /Cut only what the draft carries forward/);
});

test('an import with no spec to read still says what it is answering', () => {
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object-aside-1'], bid: 'b9' } },
    comments: [{ kind: 'human', body: '@agent @import' }],
  };
  const [a] = actionsForThread(t, { specId: 'sp1', cli: CLI });
  assert.equal(a.target, undefined);
  assert.match(a.next, /object-aside-1/, 'the aside, at least');
});

test('a dismiss says which aside and nothing about sections', () => {
  const t = {
    id: 'th_1',
    anchor: { block: { sectionPath: ['object-aside-1'], bid: 'b9' } },
    comments: [{ kind: 'human', body: '@agent @dismiss' }],
  };
  const [a] = actionsForThread(t, { specId: 'sp1', cli: CLI });
  assert.match(a.next, /object-aside-1/);
  assert.equal(/Edit the section/.test(a.next), false, 'it deletes a draft, it does not edit the spec');
});

test('only the human comments are read', () => {
  // An agent reply quoting an action it just ran must not queue it again.
  const t = thread('@agent this is fine');
  t.comments.push({ kind: 'agent', author: 'claude', body: 'Ran @visualize as asked.' });
  assert.deepEqual(resolve(t), []);
});

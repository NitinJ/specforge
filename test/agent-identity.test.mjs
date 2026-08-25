// Who a reply is signed by, and how the browser tells an agent from a person.
//
// Two rules that look similar and are not. The WRITE path takes the name from
// the running harness, so a thread worked by two CLIs says which wrote which.
// The READ path trusts the explicit `kind` field and falls back to the author
// string only for comments written before that field existed, which were all
// Claude's. Widening the fallback would let a person called `pi` have their
// comments read as an agent's (D7, I3).
//
// Spec e9ddcddef6, stage 2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { cmdReply } from '../lib/specforge-cli.mjs';
import { createSpec } from '../lib/store.mjs';
import { mutateComments, loadComments } from '../lib/store-comments.mjs';
import { kindOf, createThread } from '../lib/comments.mjs';
import { RESERVED_NAMES, AGENT_NAME } from '../lib/mentions.mjs';
import { agentNames, harnessIds } from '../lib/harness/index.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-agentid-');

const anchor = { block: { index: 1, tag: 'P', text: 'a paragraph' } };

/** A spec carrying one open thread a person started, ready to be replied to. */
function specWithThread() {
  const id = createSpec({ title: 'A', html: '<h1>A</h1><p>a paragraph</p>' });
  const thread = mutateComments(id, (store) =>
    createThread(store, { anchor, body: '@agent what about this?', author: 'nitin' }));
  return { id, tid: thread.id };
}

// --- the write path ---------------------------------------------------------

test('a reply is signed with the running harness agent name', async () => {
  const { id, tid } = specWithThread();
  const out = await cmdReply({ id, tid, body: 'answered' });
  assert.equal(out.comment.kind, 'agent');
  assert.ok(agentNames().includes(out.comment.author), `got ${out.comment.author}`);
});

test('the reply lands on the thread, readable as the agent\'s', () => {
  const { id, tid } = specWithThread();
  return cmdReply({ id, tid, body: 'answered' }).then(() => {
    const [thread] = loadComments(id).threads;
    const reply = thread.comments[thread.comments.length - 1];
    assert.equal(kindOf(reply), 'agent');
    assert.equal(reply.body, 'answered');
    assert.equal(kindOf(thread.comments[0]), 'human', 'and the question is still a person\'s');
  });
});

test('the name is a harness agent name, not a hardcoded literal', () => {
  // The assertion that would have failed before this stage: `claude` was written
  // straight into the call, so a Pi session signed its replies claude.
  assert.deepEqual(agentNames(), harnessIds().map((id) => id),
    'one agent name per harness, and today they match the ids');
});

// --- the read path (D7, I3) -------------------------------------------------

test('an explicit kind always decides, whatever the author is called', () => {
  assert.equal(kindOf({ author: 'nitin', kind: 'agent' }), 'agent');
  assert.equal(kindOf({ author: 'claude', kind: 'human' }), 'human');
});

test('a person called pi is a human, not an agent (I3)', () => {
  // The fallback is deliberately not widened to the new agent names. A name a
  // client supplies must never be able to claim agent authorship.
  assert.equal(kindOf({ author: 'pi' }), 'human');
  assert.equal(kindOf({ author: 'codex' }), 'human');
});

test('the legacy fallback still recognises claude, and only claude', () => {
  // Comments written before `kind` existed carry no field, and every one of them
  // was Claude's.
  assert.equal(kindOf({ author: 'claude' }), 'agent');
  assert.equal(kindOf({ author: 'nitin' }), 'human');
});

// --- reserved names ---------------------------------------------------------

test('every harness agent name is reserved', () => {
  for (const name of agentNames()) {
    assert.ok(RESERVED_NAMES.has(name), `${name} is reserved`);
  }
  assert.ok(RESERVED_NAMES.has(AGENT_NAME));
  assert.ok(RESERVED_NAMES.has('human'));
});

test('the reserved set is derived from the registry, not listed', () => {
  // Adding a harness must reserve its name with no second edit. Asserted by
  // shape: every agent name is in the set, and the set holds nothing that is
  // neither an agent name nor one of the two fixed entries.
  const fixed = new Set([AGENT_NAME, 'human']);
  for (const name of RESERVED_NAMES) {
    if (fixed.has(name)) continue;
    assert.ok(agentNames().includes(name), `${name} is an agent name or a fixed entry`);
  }
});

test('an ordinary name is not reserved', () => {
  assert.equal(RESERVED_NAMES.has('nitin'), false);
});

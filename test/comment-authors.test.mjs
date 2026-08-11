// Authors and routing.
//
// `author` used to answer two questions at once: who wrote this, and does an
// agent act on it. A second person breaks the second use, so `kind` takes over
// the routing half and `author` becomes a free display name.
//
// Nothing on disk is rewritten: a comment stored before this change has no
// `kind`, and its kind is derived from the author string on read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThread, addComment, kindOf, isAgent, isForAgent } from '../lib/comments.mjs';

const anchor = { block: { index: 1, tag: 'P', text: 'a block' } };
const fresh = () => ({ specId: 's', threads: [] });

test('a comment carries the name given and a human kind', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'why 40 bits?', author: 'lavee' });
  assert.equal(t.comments[0].author, 'lavee');
  assert.equal(t.comments[0].kind, 'human');
});

test('an agent comment is marked by kind, not by its name', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'q', author: 'lavee' });
  const c = addComment(store, t.id, { body: 'answered', author: 'claude', kind: 'agent' });
  assert.equal(c.kind, 'agent');
  assert.equal(t.state, 'replied', 'an agent reply moves an open thread to replied');
});

// A person named "claude" must not be able to impersonate the agent, so kind is
// never inferred from the name on write.
test('a person may be called claude without becoming the agent', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'q', author: 'claude', kind: 'human' });
  assert.equal(kindOf(t.comments[0]), 'human');
  assert.equal(t.state, 'open', 'a human comment does not mark the thread replied');
});

test('legacy comments derive their kind from the old author strings', () => {
  assert.equal(kindOf({ author: 'human' }), 'human');
  assert.equal(kindOf({ author: 'claude' }), 'agent');
  assert.equal(kindOf({ author: 'lavee' }), 'human');
  // An explicit kind always wins over the derivation.
  assert.equal(kindOf({ author: 'claude', kind: 'human' }), 'human');
  assert.equal(isAgent({ author: 'claude' }), true);
  assert.equal(isAgent({ author: 'nitin' }), false);
});

test('any human reopens a resolved thread, not just the original author', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'q', author: 'nitin' });
  t.state = 'resolved';
  addComment(store, t.id, { body: 'more', author: 'lavee' });
  assert.equal(t.state, 'open');
});

test('an agent reply does not reopen a resolved thread', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'q', author: 'nitin' });
  t.state = 'resolved';
  addComment(store, t.id, { body: 'fyi', author: 'claude', kind: 'agent' });
  assert.equal(t.state, 'resolved');
});

// --- Which threads an agent acts on ---

test('a thread with no mention is discussion', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'why 40 bits?', author: 'lavee' });
  assert.equal(isForAgent(t), false);
});

test('a mention anywhere in the thread makes it agent work', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'why 40 bits?', author: 'lavee' });
  addComment(store, t.id, { body: 'good point', author: 'nitin' });
  assert.equal(isForAgent(t), false);
  addComment(store, t.id, { body: '@agent please widen it', author: 'nitin' });
  assert.equal(isForAgent(t), true, 'handing a discussion over works after the fact');
});

// Otherwise an agent could keep its own thread alive by quoting the token.
test('only a human mention counts', () => {
  const store = fresh();
  const t = createThread(store, { anchor, body: 'q', author: 'lavee' });
  addComment(store, t.id, { body: 'ask @agent next time', author: 'claude', kind: 'agent' });
  assert.equal(isForAgent(t), false);
});

test('a legacy thread with no mention is discussion, not agent work', () => {
  const legacy = {
    id: 'th_1', state: 'open', anchor,
    comments: [{ id: 'c_1', author: 'human', body: 'tighten this' }],
  };
  assert.equal(isForAgent(legacy), false);
});

// Every comment on a spec written before mentions existed was agent work by
// construction and carries no @agent. A thread already sent must stay the
// agent's, or a spec mid-review loses its place the moment this ships: the
// lifecycle CTA would stop reporting it as awaiting a reply.
test('a legacy thread already submitted is still agent work', () => {
  const submitted = {
    id: 'th_1', state: 'open', anchor,
    comments: [{ id: 'c_1', author: 'human', body: 'tighten this', batchId: 'b1' }],
  };
  assert.equal(isForAgent(submitted), true);
});

test('a submitted thread the agent answered is still agent work', () => {
  const answered = {
    id: 'th_1', state: 'replied', anchor,
    comments: [
      { id: 'c_1', author: 'human', body: 'tighten this', batchId: 'b1' },
      { id: 'c_2', author: 'claude', body: 'done' },
    ],
  };
  assert.equal(isForAgent(answered), true);
});

// What a submit hands to an agent.
//
// It used to be every unsubmitted comment, because every comment was agent
// work by construction. Now a batch is the human side of the threads that
// addressed the agent, and discussion never wakes anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-batch-'));
process.env.SPECFORGE_HOME = home;

const { mutateComments, createThread, addComment } = await import('../lib/store-comments.mjs');
const { submitBatch } = await import('../lib/store-inbox.mjs');
const { commentsPath } = await import('../lib/store-paths.mjs');

const anchor = { block: { index: 1, tag: 'P', text: 'a block' } };
let n = 0;
const nextSpec = () => `spec${++n}`;

/** Comments in `store` carrying `batchId`, flattened. */
function batched(id, batchId) {
  const store = JSON.parse(readFileSync(commentsPath(id), 'utf8'));
  return store.threads.flatMap((t) => t.comments.filter((c) => c.batchId === batchId).map((c) => c.body));
}

test('a discussion-only thread produces no batch', () => {
  const id = nextSpec();
  mutateComments(id, (s) => createThread(s, { anchor, body: 'why 40 bits?', author: 'lavee' }));
  assert.equal(submitBatch(id), null, 'nothing to submit');
});

test('a thread addressing the agent is submitted', () => {
  const id = nextSpec();
  mutateComments(id, (s) => createThread(s, { anchor, body: '@agent widen this', author: 'nitin' }));
  const batch = submitBatch(id);
  assert.ok(batch, 'a batch was created');
  assert.equal(batch.threadIds.length, 1);
  assert.deepEqual(batched(id, batch.batchId), ['@agent widen this']);
});

test('only the addressed threads go, and discussion stays behind', () => {
  const id = nextSpec();
  mutateComments(id, (s) => {
    createThread(s, { anchor, body: 'why 40 bits?', author: 'lavee' });
    createThread(s, { anchor, body: '@agent widen the table', author: 'nitin' });
  });
  const batch = submitBatch(id);
  assert.equal(batch.threadIds.length, 1);
  assert.deepEqual(batched(id, batch.batchId), ['@agent widen the table']);
});

// The point of thread-level routing: the agent gets the reasoning, not just the
// instruction that happened to carry the mention.
test('handing a discussion over sends the whole discussion as context', () => {
  const id = nextSpec();
  let tid;
  mutateComments(id, (s) => {
    const t = createThread(s, { anchor, body: 'why 40 bits?', author: 'lavee' });
    tid = t.id;
    addComment(s, tid, { body: 'because the id space is small', author: 'nitin' });
    addComment(s, tid, { body: '@agent make it 64', author: 'lavee' });
  });
  const batch = submitBatch(id);
  assert.deepEqual(batched(id, batch.batchId), [
    'why 40 bits?',
    'because the id space is small',
    '@agent make it 64',
  ]);
});

test('agent replies are never batched back to the agent', () => {
  const id = nextSpec();
  mutateComments(id, (s) => {
    const t = createThread(s, { anchor, body: '@agent fix this', author: 'nitin' });
    addComment(s, t.id, { body: 'done', author: 'claude', kind: 'agent' });
  });
  const batch = submitBatch(id);
  assert.deepEqual(batched(id, batch.batchId), ['@agent fix this']);
});

test('a resolved thread is left alone even when it mentions the agent', () => {
  const id = nextSpec();
  mutateComments(id, (s) => {
    const t = createThread(s, { anchor, body: '@agent old news', author: 'nitin' });
    t.state = 'resolved';
  });
  assert.equal(submitBatch(id), null);
});

test('a comment already in a batch is not sent twice', () => {
  const id = nextSpec();
  let tid;
  mutateComments(id, (s) => {
    const t = createThread(s, { anchor, body: '@agent first', author: 'nitin' });
    tid = t.id;
  });
  const first = submitBatch(id);
  mutateComments(id, (s) => addComment(s, tid, { body: '@agent second', author: 'nitin' }));
  const second = submitBatch(id);
  assert.deepEqual(batched(id, first.batchId), ['@agent first']);
  assert.deepEqual(batched(id, second.batchId), ['@agent second']);
});

// Threads written before mentions existed carry no @agent and must not be
// swept into a batch by a submit that happens years later.
test('legacy comments are discussion unless they address the agent', () => {
  const id = nextSpec();
  mutateComments(id, (s) => {
    s.threads.push({
      id: 'th_legacy', state: 'open', anchor,
      comments: [{ id: 'c_legacy', author: 'human', body: 'tighten this' }],
    });
  });
  assert.equal(submitBatch(id), null);
});

process.on('exit', () => rmSync(home, { recursive: true, force: true }));

// What the index says a spec needs from you.
//
// These are the rules the spec's own lifecycle button uses. If the two disagree
// the index is worse than nothing, so they are tested against the same cases.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-sig-'));
process.env.SPECFORGE_HOME = home;

const { specSignals } = await import('../lib/spec-signals.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { mutateComments, createThread, addComment } = await import('../lib/store-comments.mjs');
const { submitBatch } = await import('../lib/store-inbox.mjs');
const { sharePath } = await import('../lib/store-paths.mjs');

const anchor = { block: { index: 1, tag: 'P', text: 'a block' } };
const spec = (title) => createSpec({ title, html: `<h1>${title}</h1>` });

after(() => rmSync(home, { recursive: true, force: true }));

test('a spec with nothing on it is clear', () => {
  const id = spec('quiet');
  const s = specSignals(id);
  assert.equal(s.review, 'clear');
  assert.equal(s.open, 0);
  assert.equal(s.shared, false);
});

test('discussion reads as discussion, not as work', () => {
  const id = spec('chatty');
  mutateComments(id, (st) => createThread(st, { anchor, body: 'why 40 bits?', author: 'lavee' }));
  const s = specSignals(id);
  assert.equal(s.review, 'discussion');
  assert.equal(s.discussion, 1);
  assert.equal(s.needs, 0, 'nobody asked the agent for anything');
});

test('an unsent mention is work waiting on you', () => {
  const id = spec('todo');
  mutateComments(id, (st) => createThread(st, { anchor, body: '@agent widen this', author: 'nitin' }));
  const s = specSignals(id);
  assert.equal(s.review, 'needs');
  assert.equal(s.needs, 1);
});

test('a submitted batch reads as awaiting', () => {
  const id = spec('sent');
  mutateComments(id, (st) => createThread(st, { anchor, body: '@agent widen this', author: 'nitin' }));
  submitBatch(id);
  const s = specSignals(id);
  assert.equal(s.review, 'awaiting');
  assert.equal(s.awaiting, true);
  assert.equal(s.needs, 0, 'it is sent, so there is nothing left to send');
});

test('an agent reply reads as replies to read', () => {
  const id = spec('answered');
  let tid;
  mutateComments(id, (st) => { tid = createThread(st, { anchor, body: '@agent widen this', author: 'nitin' }).id; });
  submitBatch(id);
  mutateComments(id, (st) => addComment(st, tid, { body: 'done', author: 'claude', kind: 'agent' }));
  const s = specSignals(id);
  assert.equal(s.review, 'replied');
  assert.equal(s.replied, 1);
});

// Unsent work outranks everything: it is the only state whose next action is
// yours and immediate.
test('unsent comments outrank replies to read', () => {
  const id = spec('both');
  let tid;
  mutateComments(id, (st) => { tid = createThread(st, { anchor, body: '@agent one', author: 'nitin' }).id; });
  submitBatch(id);
  mutateComments(id, (st) => addComment(st, tid, { body: 'done', author: 'claude', kind: 'agent' }));
  mutateComments(id, (st) => createThread(st, { anchor, body: '@agent two', author: 'nitin' }));
  assert.equal(specSignals(id).review, 'needs');
});

test('resolved threads count for nothing', () => {
  const id = spec('tidy');
  mutateComments(id, (st) => {
    const t = createThread(st, { anchor, body: '@agent widen this', author: 'nitin' });
    t.state = 'resolved';
  });
  const s = specSignals(id);
  assert.equal(s.review, 'clear');
  assert.equal(s.open, 0);
});

test('a share is reported, and its liveness comes from the caller', () => {
  const id = spec('public');
  writeFileSync(sharePath(id), JSON.stringify({
    specId: id, url: 'https://calm-fox.trycloudflare.com', port: 1, pid: 2, createdAt: 'now',
  }));
  const dead = specSignals(id);
  assert.equal(dead.shared, true);
  assert.equal(dead.shareUrl, 'https://calm-fox.trycloudflare.com');
  assert.equal(dead.shareLive, false, 'a record alone is not proof the link works');

  const live = specSignals(id, () => true);
  assert.equal(live.shareLive, true);
});

test('an unreadable comment store does not break the row', () => {
  const id = spec('broken');
  writeFileSync(join(home, 'specs', id, 'comments.json'), '{ not json');
  const s = specSignals(id);
  assert.equal(s.review, 'clear', 'the index still renders');
});

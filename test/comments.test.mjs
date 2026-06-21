import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadStore, saveStore, createThread, addComment, editComment, resolveThread, findThread, storePath,
} from '../lib/comments.mjs';

const anchor = { block: { index: 1, tag: 'P', text: 'the problem and its context' } };

test('loadStore returns an empty store when none exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-c-'));
  const store = loadStore(dir, 'abc123', 'specs/x.html');
  assert.deepEqual(store.threads, []);
  assert.equal(store.specId, 'abc123');
});

test('createThread + addComment lifecycle; claude reply flips to replied', () => {
  const store = { specId: 'id1', specPath: 'x.html', threads: [] };
  const t = createThread(store, { anchor, body: 'why this?' });
  assert.equal(t.state, 'open');
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].author, 'human');

  addComment(store, t.id, { body: 'because Y', author: 'claude' });
  assert.equal(findThread(store, t.id).state, 'replied');
  assert.equal(t.comments.length, 2);

  addComment(store, t.id, { body: 'thanks', author: 'human' });
  assert.equal(t.state, 'replied'); // human reply does not un-reply
});

test('a human reply to a resolved thread reopens it (resolved → open)', () => {
  const store = { specId: 'id1', specPath: 'x.html', threads: [] };
  const t = createThread(store, { anchor, body: 'why this?' });
  resolveThread(store, t.id);
  assert.equal(t.state, 'resolved');
  addComment(store, t.id, { body: 'actually, reconsider', author: 'human' });
  assert.equal(t.state, 'open', 'new human feedback reopens a resolved thread');
});

test('a claude reply to a resolved thread leaves it resolved', () => {
  const store = { specId: 'id1', specPath: 'x.html', threads: [] };
  const t = createThread(store, { anchor, body: 'q' });
  resolveThread(store, t.id);
  addComment(store, t.id, { body: 'fyi', author: 'claude' });
  assert.equal(t.state, 'resolved');
});

test('editComment + resolveThread', () => {
  const store = { specId: 'id1', specPath: 'x.html', threads: [] };
  const t = createThread(store, { anchor, body: 'first' });
  editComment(store, t.id, t.comments[0].id, 'edited');
  assert.equal(t.comments[0].body, 'edited');
  resolveThread(store, t.id);
  assert.equal(t.state, 'resolved');
});

test('validation: missing anchor/body throws', () => {
  const store = { specId: 'id1', specPath: 'x.html', threads: [] };
  assert.throws(() => createThread(store, { anchor: {}, body: 'x' }));
  assert.throws(() => createThread(store, { anchor, body: '  ' }));
});

test('save/load round-trips and keeps a separate file per spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-c-'));
  const a = loadStore(dir, 'specA', 'a.html');
  createThread(a, { anchor, body: 'A comment' });
  saveStore(dir, a);
  const b = loadStore(dir, 'specB', 'b.html');
  createThread(b, { anchor, body: 'B comment' });
  saveStore(dir, b);

  assert.ok(existsSync(storePath(dir, 'specA')));
  assert.ok(existsSync(storePath(dir, 'specB')));
  assert.notEqual(storePath(dir, 'specA'), storePath(dir, 'specB'));
  assert.equal(loadStore(dir, 'specA').threads[0].comments[0].body, 'A comment');
  assert.equal(loadStore(dir, 'specB').threads.length, 1);
});

// Per-spec comment store. Each spec gets its own store at
// <specsDir>/.specforge/<specId>/comments.json — comments are kept separately
// per spec and never mixed.
//
// Shape:
//   { specId, specPath, threads: [
//       { id, state: "open"|"replied"|"resolved",
//         anchor: { sectionId, quote?: {exact, prefix, suffix}, textPosition?: {start,end} },
//         comments: [ { id, author: "human"|"claude", body, createdAt, batchId?, editedSpec? } ] } ] }

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function storeDir(specsDir, specId) {
  return join(specsDir, '.specforge', specId);
}

export function storePath(specsDir, specId) {
  return join(storeDir(specsDir, specId), 'comments.json');
}

function rid(prefix) {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

/** Load a spec's store, returning a fresh empty store if none exists yet. */
export function loadStore(specsDir, specId, specPath = '') {
  try {
    const raw = JSON.parse(readFileSync(storePath(specsDir, specId), 'utf8'));
    if (!Array.isArray(raw.threads)) raw.threads = [];
    return raw;
  } catch {
    return { specId, specPath, threads: [] };
  }
}

export function saveStore(specsDir, store) {
  mkdirSync(storeDir(specsDir, store.specId), { recursive: true });
  writeFileSync(storePath(specsDir, store.specId), JSON.stringify(store, null, 2));
  return store;
}

export function findThread(store, threadId) {
  return store.threads.find((t) => t.id === threadId) || null;
}

/**
 * Create a new thread with its first comment.
 * @param {object} store
 * @param {{anchor:object, body:string, author?:string, batchId?:string}} input
 */
export function createThread(store, { anchor, body, author = 'human', batchId, now = new Date().toISOString() }) {
  if (!anchor || !anchor.sectionId) throw new Error('anchor.sectionId is required');
  if (!body || !body.trim()) throw new Error('comment body is required');
  const thread = {
    id: rid('th'),
    state: 'open',
    anchor,
    comments: [{ id: rid('c'), author, body, createdAt: now, ...(batchId ? { batchId } : {}) }],
  };
  store.threads.push(thread);
  return thread;
}

/** Append a comment to a thread. A claude reply flips an open thread to "replied". */
export function addComment(store, threadId, { body, author = 'human', batchId, editedSpec, now = new Date().toISOString() }) {
  const thread = findThread(store, threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  if (!body || !body.trim()) throw new Error('comment body is required');
  const comment = { id: rid('c'), author, body, createdAt: now };
  if (batchId) comment.batchId = batchId;
  if (editedSpec) comment.editedSpec = true;
  thread.comments.push(comment);
  if (author === 'claude' && thread.state !== 'resolved') thread.state = 'replied';
  return comment;
}

export function editComment(store, threadId, commentId, body) {
  const thread = findThread(store, threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  const comment = thread.comments.find((c) => c.id === commentId);
  if (!comment) throw new Error(`comment not found: ${commentId}`);
  if (!body || !body.trim()) throw new Error('comment body is required');
  comment.body = body;
  return comment;
}

/** Resolve a thread (humans only). Resolved threads stay in the store for history. */
export function resolveThread(store, threadId) {
  const thread = findThread(store, threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  thread.state = 'resolved';
  return thread;
}

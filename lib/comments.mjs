// Per-spec comment store. Each spec gets its own store at
// <specsDir>/.specforge/<specId>/comments.json — comments are kept separately
// per spec and never mixed.
//
// Shape:
//   { specId, specPath, threads: [
//       { id, state: "open"|"replied"|"resolved",
//         anchor: { block: { index, tag, text } },   // block-level; see server/public/review.js
//         comments: [ { id, author, kind: "human"|"agent", body, createdAt, batchId?, editedSpec? } ] } ] }
//
// `author` is a free display name and `kind` says whether an agent wrote it.
// They were one field once, which worked only while a spec had a single human
// on it. Comments written before the split carry no `kind`; kindOf() derives it
// from the old author strings, and no stored file is ever rewritten.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mentionsAgent } from './mentions.mjs';

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
 * Whether a comment was written by a human or an agent.
 *
 * An explicit `kind` always wins. Only a comment stored before the split falls
 * back to the author string, where `claude` was the agent's only name. Never
 * infer from the name on write: a person may legitimately be called claude, and
 * a name a client supplies must not be able to claim agent authorship.
 */
export function kindOf(comment) {
  if (comment && (comment.kind === 'agent' || comment.kind === 'human')) return comment.kind;
  return comment && comment.author === 'claude' ? 'agent' : 'human';
}

/** True when an agent wrote this comment. */
export function isAgent(comment) {
  return kindOf(comment) === 'agent';
}

/**
 * True when an agent should act on this thread: some human in it addressed the
 * agent. An agent's own mention does not count, or a thread could keep itself
 * alive by quoting the token.
 *
 * This decides what a submit sends, so it is deliberately about the mention and
 * nothing else. A thread that was sent once does not keep sending: a later
 * "thanks, that works" in an answered thread is a remark to a person, and
 * re-engaging an agent with it would be surprising and expensive.
 */
export function isForAgent(thread) {
  if (!thread || !Array.isArray(thread.comments)) return false;
  // The mention has to be on a comment that has not been sent yet. A mention
  // that was already delivered is history: without this, one @agent early in a
  // thread makes every later remark in it agent work forever, so "looks good
  // now" on an answered thread would be submitted as a request.
  return thread.comments.some((c) => !isAgent(c) && !c.batchId && mentionsAgent(c.body));
}

/**
 * True when this thread has been sent to an agent at some point.
 *
 * Separate from isForAgent because it answers a different question: not "should
 * this be sent" but "is this thread in the agent's loop", which is what the
 * lifecycle CTA reports on. It is also what keeps specs written before mentions
 * existed working, since every comment on them was agent work by construction
 * and carries no @agent.
 */
export function wasSentToAgent(thread) {
  if (!thread || !Array.isArray(thread.comments)) return false;
  return thread.comments.some((c) => !!c.batchId);
}

/**
 * Create a new thread with its first comment.
 * @param {object} store
 * @param {{anchor:object, body:string, author?:string, batchId?:string}} input
 */
export function createThread(store, { anchor, body, author = 'human', kind, batchId, now = new Date().toISOString() }) {
  if (!anchor || !anchor.block || !anchor.block.text || !anchor.block.text.trim()) throw new Error('anchor.block with text is required');
  if (!body || !body.trim()) throw new Error('comment body is required');
  const thread = {
    id: rid('th'),
    state: 'open',
    anchor,
    comments: [{ id: rid('c'), author, kind: kind || kindOf({ author }), body, createdAt: now, ...(batchId ? { batchId } : {}) }],
  };
  store.threads.push(thread);
  return thread;
}

/** Append a comment to a thread. An agent reply flips an open thread to "replied". */
export function addComment(store, threadId, { body, author = 'human', kind: explicitKind, batchId, editedSpec, now = new Date().toISOString() }) {
  const thread = findThread(store, threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  if (!body || !body.trim()) throw new Error('comment body is required');
  // An explicit kind wins; without one it follows the author, which keeps every
  // caller written before the split behaving as it did. The HTTP API always
  // passes it explicitly, so no client can reach this fallback to claim agent
  // authorship by naming itself claude.
  const kind = explicitKind || kindOf({ author });
  const comment = { id: rid('c'), author, kind, body, createdAt: now };
  if (batchId) comment.batchId = batchId;
  if (editedSpec) comment.editedSpec = true;
  thread.comments.push(comment);
  if (kind === 'agent' && thread.state !== 'resolved') thread.state = 'replied';
  // A human comment on a resolved thread is new feedback — reopen it so the agent
  // (and the action button) treat it as live again. Any human does this, not only
  // whoever opened the thread. A reply to an already-open or agent-`replied`
  // thread is left as-is (the conversation continues).
  if (kind !== 'agent' && thread.state === 'resolved') thread.state = 'open';
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

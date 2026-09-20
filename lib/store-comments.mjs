// Per-spec comment store for the v2 global store — the store-id-keyed analogue
// of v1's specsDir-keyed comments.mjs. Threads live at
// ~/.specforge/specs/<id>/comments.json. The pure thread operations
// (createThread/addComment/editComment/resolveThread/findThread) are shared with
// v1 — only load/save are rooted at the global store here.
//
// Concurrency: comments.json is read-modify-written by two separate processes —
// the daemon (human submit / reply / resolve) and the agent CLI (claude reply).
// saveComments is therefore atomic (temp + rename, so a reader never sees a torn
// file), and mutateComments() runs the whole read-modify-write under a per-spec
// lock so the two processes can't lose each other's update.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { specDir, commentsPath, commentsLockPath } from './store-paths.mjs';
import { withFileLock } from './file-lock.mjs';
import { revokeApprovalIfUnresolved } from './lifecycle.mjs';

export {
  createThread, addComment, editComment, resolveThread, findThread,
} from './comments.mjs';

/** Load a spec's comment store, or a fresh empty store if none exists yet. */
export function loadComments(id) {
  try {
    const raw = JSON.parse(readFileSync(commentsPath(id), 'utf8'));
    if (!Array.isArray(raw.threads)) raw.threads = [];
    return raw;
  } catch {
    return { specId: id, threads: [] };
  }
}

/** Atomically write a spec's comment store (temp + rename — no torn reads). */
export function saveComments(id, store) {
  mkdirSync(specDir(id), { recursive: true });
  const tmp = `${commentsPath(id)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, commentsPath(id)); // atomic on the same filesystem
  return store;
}

/**
 * Run `fn` under a per-spec exclusive lock, serializing the comments.json
 * read-modify-write across processes.
 *
 * The lock itself moved to lib/file-lock.mjs when the watcher beat became a
 * second writer of meta.json and needed the same guarantee. Behaviour here is
 * unchanged, including the best-effort fallback.
 */
export function withCommentsLock(id, fn) {
  mkdirSync(specDir(id), { recursive: true });
  return withFileLock(commentsLockPath(id), fn);
}

/**
 * The safe read-modify-write for comments.json: lock, load, apply `fn(store)`,
 * save, unlock. Returns whatever `fn` returns. Use this for every mutation
 * instead of a bare loadComments + saveComments.
 */
export function mutateComments(id, fn) {
  return withCommentsLock(id, () => {
    const store = loadComments(id);
    const before = JSON.stringify(store);
    const result = fn(store);
    // Skip the write when fn made no change — avoids redundant mtime churn.
    if (JSON.stringify(store) !== before) {
      saveComments(id, store);
      // Approval does not survive an open objection. Enforced here because every
      // write to a spec's threads comes through this function — creating, replying,
      // editing, resolving, from the daemon and the agent CLI alike. A per-caller
      // check would eventually miss one, and the miss is an approval that quietly
      // outlives the comment disputing it.
      revokeApprovalIfUnresolved(id, store.threads.filter((t) => t.state !== 'resolved').length);
    }
    return result;
  });
}

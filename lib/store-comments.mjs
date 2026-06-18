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

import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync, statSync } from 'node:fs';
import { specDir, commentsPath, commentsLockPath } from './store-paths.mjs';

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

const LOCK_STALE_MS = 5000; // a lock older than this is presumed abandoned
const LOCK_WAIT_MS = 3000; // total time to wait for the lock before going best-effort
const LOCK_RETRY_MS = 20;

/** Synchronous sleep (no event-loop hot-spin) — these critical sections are sub-ms. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` under a per-spec exclusive lock (O_EXCL lockfile). Serializes the
 * comments.json read-modify-write across processes. Best-effort: if the lock
 * can't be acquired within the wait budget it proceeds anyway (degrades to the
 * old unlocked write rather than hanging). A stale lock (dead holder) is reclaimed.
 */
export function withCommentsLock(id, fn) {
  mkdirSync(specDir(id), { recursive: true });
  const path = commentsLockPath(id);
  let fd;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fd = openSync(path, 'wx'); break; } // create-exclusive; throws EEXIST if held
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) { rmSync(path, { force: true }); continue; }
      } catch { continue; } // lock vanished between EEXIST and stat — retry to grab it
      if (Date.now() >= deadline) break; // give up waiting; proceed best-effort
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    try { rmSync(path, { force: true }); } catch { /* already gone */ }
  }
}

/**
 * The safe read-modify-write for comments.json: lock, load, apply `fn(store)`,
 * save, unlock. Returns whatever `fn` returns. Use this for every mutation
 * instead of a bare loadComments + saveComments.
 */
export function mutateComments(id, fn) {
  return withCommentsLock(id, () => {
    const store = loadComments(id);
    const result = fn(store);
    saveComments(id, store);
    return result;
  });
}

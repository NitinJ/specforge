// A per-file exclusive lock, for read-modify-write on JSON in the store.
//
// Lifted out of store-comments.mjs unchanged when the watcher beat became a
// second writer of meta.json: two harnesses connected to one spec both beat it
// every fifteen seconds, and read-modify-write with no lock loses whichever
// update lands second. What it loses is the other harness's connection record,
// which is the one thing the switcher reads.
//
// Best-effort by design. If the lock cannot be acquired inside the wait budget
// it proceeds anyway, degrading to the unlocked write rather than hanging: a
// heartbeat that blocks is worse than a heartbeat that races, and the next beat
// is fifteen seconds away.

import { openSync, closeSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOCK_STALE_MS = 5000; // a lock older than this is presumed abandoned
const LOCK_WAIT_MS = 3000; // total time to wait before going best-effort
const LOCK_RETRY_MS = 20;

/** Synchronous sleep (no event-loop hot-spin) — these critical sections are sub-ms. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock at `lockPath` (O_EXCL lockfile).
 *
 * A stale lock, one whose holder died without releasing it, is reclaimed after
 * LOCK_STALE_MS.
 */
export function withFileLock(lockPath, fn) {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fd = openSync(lockPath, 'wx'); break; } // create-exclusive; throws EEXIST if held
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { rmSync(lockPath, { force: true }); continue; }
      } catch { continue; } // lock vanished between EEXIST and stat — retry to grab it
      if (Date.now() >= deadline) break; // give up waiting; proceed best-effort
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    // Only release the lock if WE acquired it. On the best-effort fallback (never
    // acquired) the lock belongs to another process — deleting it would break
    // mutual exclusion and let a third process in alongside the real holder.
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
      try { rmSync(lockPath, { force: true }); } catch { /* already gone */ }
    }
  }
}

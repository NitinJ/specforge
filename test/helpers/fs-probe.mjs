// Two probes for questions about the filesystem that assertions alone cannot ask.
//
// WHY NOT A SPY. The obvious shape is to patch `fs.readFileSync` and count
// calls. It does not work here: `import { readFileSync } from 'node:fs'` binds
// at module evaluation, and reassigning the property on the `fs` namespace
// afterwards leaves that binding pointing at the original function. Verified in
// this repo before choosing the alternative below, not assumed.
//
// So both probes work through the filesystem itself, which every reader goes
// through no matter how it imported its functions.

import { chmodSync, mkdirSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

const restorers = [];

/**
 * Make a path unreadable, so any attempt to read it throws EACCES.
 *
 * This is how "the code never touched that spec" is asserted: poison the file,
 * make the request, and require a clean refusal. A handler that reads the file
 * it should have refused to reach fails loudly instead of quietly passing.
 *
 * Only meaningful as a non-root user; root ignores the mode bits. `isEffective`
 * reports whether the poison actually bites, so a suite running as root skips
 * rather than passing vacuously.
 *
 * @param {string} path
 */
export function poison(path) {
  const prev = statSync(path).mode;
  chmodSync(path, 0o000);
  restorers.push(() => {
    try { chmodSync(path, prev); } catch { /* already removed */ }
  });
}

/** True when mode bits actually deny this process, i.e. we are not root. */
export function poisonBites() {
  return typeof process.getuid === 'function' && process.getuid() !== 0;
}

/** `{ skip }` for node:test, so a root runner reports skip rather than a false pass. */
export const needsPoison = {
  skip: poisonBites() ? false : 'running as root: mode bits do not deny',
};

/** Undo every poison. Safe to call when none are outstanding. */
export function unpoisonAll() {
  while (restorers.length) restorers.pop()();
}

/**
 * A directory mover that fails on the Nth call.
 *
 * Partial failure is the case worth testing and the hardest to reach by other
 * means: it needs one move in the middle of a subtree to fail while the ones
 * before it succeed. Timing a chmod between two moves is not reproducible, and
 * the mode bits that would block a rename sit on the parent directory, which is
 * shared by every spec in the store. So the store's delete takes its mover as an
 * argument, defaulting to the real one, and a test passes this.
 *
 * @param {number} failAt 1-based call index that should throw
 * @param {string} [code] the errno code to throw
 * @returns {{move: Function, calls: string[][]}}
 */
export function moverFailingAt(failAt, code = 'EACCES') {
  const calls = [];
  const move = (from, to) => {
    calls.push([from, to]);
    if (calls.length === failAt) {
      const err = new Error(`injected ${code} moving ${from}`);
      err.code = code;
      throw err;
    }
    // Same as the real mover: the destination's parent may not exist yet. An
    // earlier version skipped this and every call failed with ENOENT, so the
    // injected failure never happened and the test measured nothing.
    mkdirSync(dirname(to), { recursive: true });
    return renameSync(from, to);
  };
  return { move, calls };
}

/**
 * A mover that does the real thing and records what it was asked to move.
 *
 * For asserting order rather than failure: a subtree has to be moved deepest
 * first, so that a parent directory is never taken out from under a child that
 * has not moved yet.
 *
 * @returns {{move: Function, calls: string[][]}}
 */
export function recordingMover() {
  const calls = [];
  const move = (from, to) => {
    calls.push([from, to]);
    mkdirSync(dirname(to), { recursive: true });
    return renameSync(from, to);
  };
  return { move, calls };
}

/**
 * Seed a directory that a rename cannot overwrite.
 *
 * A rename onto a non-empty directory fails with ENOTEMPTY on every platform
 * this runs on, which makes it the one deterministic way to fail a specific
 * move without touching permissions.
 *
 * @param {string} dir
 */
export function makeUnoverwritable(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'occupied'), 'in the way');
}

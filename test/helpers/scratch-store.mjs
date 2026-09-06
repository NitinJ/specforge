// A store an agent can drive a skill against, with no human in the loop.
//
// Stage 11 verifies two skills by running them, and a skill run is not a
// node:test process: it is an agent invoking the CLI. It needs a store that
// outlives one test, that is obviously disposable, and that is never the real
// one at ~/.specforge. This makes that store and prints the two lines an agent
// needs to use it.
//
// Deliberately not auto-deleted. A skill run that fails is worth looking at
// afterwards, and a fixture that erases the evidence on the way out is the
// wrong trade for a directory under /tmp.

import { mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';

/**
 * Make a scratch store and report how to point a command at it.
 *
 * @param {string} [prefix]
 * @returns {{dir: string, env: object, hint: string}}
 */
export function makeScratchStore(prefix = 'sf-scratch-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    env: { ...process.env, SPECFORGE_HOME: dir },
    hint: `SPECFORGE_HOME=${dir}`,
  };
}

/**
 * Remove a scratch store. Refuses anything that is not under the temp dir.
 *
 * The containment check resolves both paths before comparing, because a string
 * prefix test does not survive `..`: `/tmp/../home/nitin` starts with `/tmp/`
 * and is not in /tmp, and this function ends in a recursive delete. `relative`
 * decides instead, which also gets the answer right on a platform whose
 * separator is not `/`. Symlinks are resolved for the same reason: a scratch
 * dir that is a link out of /tmp must not pass.
 */
export function removeScratchStore(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error(`refusing to remove ${dir}: not a path`);
  }

  const real = (p) => {
    try { return realpathSync(p); } catch { return resolve(p); }
  };
  const root = real(tmpdir());
  const target = real(dir);

  const rel = relative(root, target);
  const contained = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  if (!contained) {
    throw new Error(`refusing to remove ${dir}: not under ${root}`);
  }

  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

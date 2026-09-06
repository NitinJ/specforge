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

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** Remove a scratch store. Refuses anything that is not under the temp dir. */
export function removeScratchStore(dir) {
  const root = tmpdir();
  if (!dir || !dir.startsWith(root + '/')) {
    throw new Error(`refusing to remove ${dir}: not under ${root}`);
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

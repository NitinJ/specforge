// A throwaway spec store for a test file.
//
// Every store-touching test needs the same four lines: mkdtemp, point
// SPECFORGE_HOME at it, restore the previous value, remove the directory. The
// previous value is restored rather than deleted because a developer running the
// suite against a real store should get it back.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Register a fresh store per test.
 * @param {{beforeEach:Function, afterEach:Function}} hooks node:test's hooks
 * @param {string} [prefix] directory prefix, to tell suites apart in /tmp
 * @returns {{dir: string}} live handle; `dir` is rebound before each test
 */
export function useTempStore(hooks, prefix = 'sf-test-') {
  const handle = { dir: '' };
  let prev;

  hooks.beforeEach(() => {
    handle.dir = mkdtempSync(join(tmpdir(), prefix));
    prev = process.env.SPECFORGE_HOME;
    process.env.SPECFORGE_HOME = handle.dir;
  });

  hooks.afterEach(() => {
    if (prev === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prev;
    rmSync(handle.dir, { recursive: true, force: true });
  });

  return handle;
}

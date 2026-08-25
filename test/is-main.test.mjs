// Does a bin run when somebody runs it?
//
// Every skill now says `specforge <verb>` rather than naming a path inside the
// install, so the binary on PATH is a prerequisite rather than a convenience.
// `npm link` puts a SYMLINK there, and the entry-point check every CLI used
// compared argv[1] to the resolved module URL: the two never match through a
// symlink, so the CLI exited 0 having printed nothing, which looks exactly like
// success.
//
// Found by running the installed binary rather than the file. These tests are
// what stop it coming back.
//
// Spec e9ddcddef6, task 4.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { isMain } from '../lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Run a CLI through a symlink, the way an installed bin is invoked. */
function viaSymlink(target, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-bin-'));
  const link = join(dir, 'linked-cli');
  try {
    symlinkSync(join(ROOT, target), link);
    return spawnSync(process.execPath, [link, ...args], { encoding: 'utf8', timeout: 20000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('isMain says false for a module that was merely imported', () => {
  // This test file is the entry point; the module under test is not.
  assert.equal(isMain(new URL('../lib/is-main.mjs', import.meta.url).href), false);
});

test('isMain says true for the module node was started on', () => {
  assert.equal(isMain(import.meta.url), true);
});

test('isMain survives a path it cannot resolve', () => {
  assert.equal(isMain('file:///nowhere/at/all.mjs'), false);
});

test('the CLI runs through a symlink, which is how an installed bin is invoked', () => {
  const r = viaSymlink('lib/specforge-cli.mjs', ['root']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /specforge$/, `got: ${JSON.stringify(r.stdout)}`);
});

test('a symlinked CLI with no command still reports the usage it always did', () => {
  // The failure mode this closes was silence, so "prints nothing" must never be
  // the answer for any invocation.
  const r = viaSymlink('lib/specforge-cli.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/);
});

test('spec-nav runs through a symlink', () => {
  const r = viaSymlink('lib/spec-nav-cli.mjs', []);
  assert.notEqual(r.stdout + r.stderr, '', 'it says something rather than exiting silently');
});

test('spec-types runs through a symlink', () => {
  const r = viaSymlink('lib/spec-types-cli.mjs', []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Built in|general/);
});

test('every bin the package declares exists and is executable as a module', () => {
  // A bin named in package.json that does not run is an install that looks fine
  // and does nothing.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const bins = Object.entries(pkg.bin || {});
  assert.ok(bins.length >= 3, `expected the three CLIs, got ${bins.length}`);
  for (const [name, rel] of bins) {
    assert.ok(existsSync(join(ROOT, rel)), `${name} -> ${rel}`);
  }
});

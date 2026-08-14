// The markdown commands as a user runs them: through the CLI binary.
//
// Everything below this has unit tests; what they cannot cover is the layer
// between a shell and the store — argument parsing, boolean flags, the JSON on
// stdout, and the exit code. A command can be wired to the wrong function and
// every unit test still passes.
//
// export-md is driven end to end because it needs no daemon. import-md ensures
// the daemon before it touches the store, so only the paths that fail BEFORE
// that are driven here; the rest is covered at the store layer in
// test/md-import.test.mjs, and by the e2e.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { fixture } from './fixtures/md/index.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { createSpec } from '../lib/store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'specforge-cli.mjs');

const store = useTempStore({ beforeEach, afterEach }, 'sf-mdcli-');

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SPECFORGE_HOME: store.dir, CLAUDE_CODE_SESSION_ID: '' },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not every command prints JSON */ }
  return { ...r, json };
}

const seed = (name, title) => createSpec({ html: fixture(name).html(), title, type: 'design' });

test('export-md writes the file and prints where it went', () => {
  const id = seed('design', 'Retry policy');
  const r = run('export-md', id, '--out', store.dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.id, id);
  assert.match(r.json.mdPath, /retry-policy\.md$/);
  assert.equal(r.json.assetsDir, null);
  assert.equal(r.json.assets, 0);
  assert.deepEqual(r.json.warnings, []);
  assert.ok(existsSync(r.json.mdPath));
  assert.match(readFileSync(r.json.mdPath, 'utf8'), /^# Retry policy for webhook delivery$/m);
});

test('export-md writes the assets directory for a spec with diagrams', () => {
  const id = seed('diagrams', 'Topology');
  const r = run('export-md', id, '--out', store.dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.assets, 2);
  assert.deepEqual(readdirSync(r.json.assetsDir).sort(), ['architecture-1.svg', 'flow-1.svg']);
});

test('--zip is a boolean flag, not one that eats the next argument', () => {
  const id = seed('diagrams', 'Topology');
  // If --zip were parsed as taking a value it would swallow --out and the export
  // would land in the working directory instead.
  const r = run('export-md', id, '--zip', '--out', store.dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.json.zipPath, /topology\.zip$/);
  assert.equal(r.json.mdPath, null);
  assert.ok(existsSync(r.json.zipPath));
});

test('export-md takes a .md path as the file to write', () => {
  const id = seed('design', 'Retry policy');
  const out = join(store.dir, 'notes.md');
  const r = run('export-md', id, '--out', out);
  assert.equal(r.json.mdPath, out);
  assert.ok(existsSync(out));
});

test('export-md fails loudly on an unknown spec', () => {
  const r = run('export-md', 'deadbeef00');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown spec deadbeef00/);
  assert.equal(r.stdout, '', 'nothing on stdout to mistake for a result');
});

test('export-md refuses a deck, and says why', () => {
  const id = createSpec({ html: fixture('design').html(), title: 'Slides', type: 'deck' });
  const r = run('export-md', id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /slide-shaped and have no markdown form/);
});

test('export-md with no id is an error, not a crash', () => {
  const r = run('export-md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /<id> required/);
});

test('import-md with no file is an error', () => {
  const r = run('import-md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /<file> required/);
});

test('import-md rejects an unknown type before touching anything', () => {
  const r = run('import-md', join(store.dir, 'x.md'), '--type', 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /invalid type "nope"/);
  assert.match(r.stderr, /general/, 'and lists the ones that exist');
});

test('both commands are in the dispatch table', () => {
  const r = run('no-such-command');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /export-md/);
  assert.match(r.stderr, /import-md/);
});

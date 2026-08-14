// `components migrate` as the agent pass runs it: through the CLI binary.
//
// The migration logic has unit tests. What they cannot cover is the contract the
// agent works against — a plan that writes nothing, a decisions file read back
// in, and JSON on stdout with an exit code. That is the whole interface between
// the skill and the store, and it can be mis-wired with every unit test green.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { createSpec } from '../lib/store.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { reportPath } from '../lib/components-migrate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'specforge-cli.mjs');

const store = useTempStore({ beforeEach, afterEach }, 'sf-migcli-');

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SPECFORGE_HOME: store.dir, CLAUDE_CODE_SESSION_ID: '' },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not every command prints JSON */ }
  return { ...r, json };
}

const SPEC = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><title>Legacy</title>
<style>
  :root{--bg:#fff;--ink:#111;--panel:#fff;--panel2:#eee;--line:#ddd;--muted:#666;
    --accent:#25f;--green:#0a0;--amber:#b50;--red:#b11;--code:#eee;--shadow:none;--mono:monospace}
  .callout{padding:8px}
</style>
</head>
<body>
<section id="s1" data-sf-section><h2>One</h2>
  <div class="callout c-risk">The stamped block is hand-edited.</div>
  <div class="callout warn">Nothing in this decides it.</div>
</section>
</body>
</html>
`;

function seed() {
  const id = createSpec({ title: 'Legacy', html: SPEC, type: 'design' });
  writeFileSync(specHtmlPath(id), SPEC);
  return id;
}
const read = (id) => readFileSync(specHtmlPath(id), 'utf8');

test('migrate --plan lists the blocks to decide and writes nothing', () => {
  const id = seed();
  const before = read(id);
  const r = run('components', 'migrate', id, '--plan');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.blocks.length, 1, 'only the one the codemod could not type');
  assert.equal(r.json.blocks[0].source, 'warn');
  assert.match(r.json.blocks[0].text, /Nothing in this decides it/);
  assert.equal(read(id), before, 'a plan is a read');
  assert.equal(existsSync(reportPath(id)), false);
});

test('migrate --assign applies the agent decisions and records them', () => {
  const id = seed();
  const plan = run('components', 'migrate', id, '--plan').json;
  const file = join(store.dir, 'assign.json');
  writeFileSync(file, JSON.stringify({ assignments: { [plan.blocks[0].index]: 'risk' } }));

  const r = run('components', 'migrate', id, '--assign', file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(id), /class="callout risk">Nothing in this decides it/);
  const a = r.json.assignments.find((x) => /Nothing in this decides it/.test(x.text));
  assert.equal(a.by, 'agent');
});

test('migrate with no decisions still finalizes, on the classifier default', () => {
  const id = seed();
  const r = run('components', 'migrate', id);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(id), /class="callout warning">Nothing in this decides it/);
  assert.equal(r.json.assignments[0].by, 'classifier');
  assert.ok(existsSync(reportPath(id)), 'and the report says so');
});

test('migrate --dry reports and writes nothing', () => {
  const id = seed();
  const before = read(id);
  const r = run('components', 'migrate', id, '--dry');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.json.codemod.length);
  assert.equal(read(id), before);
  assert.equal(existsSync(reportPath(id)), false);
});

test('migrate without an id fails, and says what it needs', () => {
  const r = run('components', 'migrate');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /migrate needs a spec id/);
});

test('migrate names an id it cannot find rather than half-running', () => {
  const r = run('components', 'migrate', 'nosuchspec');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not found/);
});

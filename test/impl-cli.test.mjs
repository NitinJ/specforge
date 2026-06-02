import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildIndex } from '../lib/paths.mjs';
import { getActive } from '../lib/active.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'impl-cli.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const RESOLVED = TEMPLATE.replace('data-sf-q="open"', 'data-sf-q="resolved"');

function specsDirWith(html) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-impl-'));
  writeFileSync(join(dir, 's-spec.html'), html);
  return { dir, id: buildIndex(dir)[0].id, file: join(dir, 's-spec.html') };
}
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 8000 });

test('gate PASSes a resolved spec, FAILs one with an open question', () => {
  const ok = specsDirWith(RESOLVED);
  const pass = run('gate', ok.dir, ok.id);
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /gate: PASS/);

  const bad = specsDirWith(TEMPLATE);
  const fail = run('gate', bad.dir, bad.id);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /open-questions-resolved/);
});

test('task + pr mutate the spec deterministically', () => {
  const { dir, id, file } = specsDirWith(RESOLVED);
  assert.equal(run('task', dir, id, '1.1', 'done').status, 0);
  assert.match(readFileSync(file, 'utf8'), /data-sf-task="1.1" data-sf-status="done"/);
  assert.equal(run('pr', dir, id, '1', '#7').status, 0);
  assert.match(readFileSync(file, 'utf8'), /data-sf-stage="1" data-sf-pr="#7"/);
});

test('start sets the active marker + implementing status; finish clears it', () => {
  const { dir, id, file } = specsDirWith(RESOLVED);
  const start = run('start', dir, id, '--stage', '1', '--task', '1.1');
  assert.equal(start.status, 0, start.stderr);
  assert.equal(getActive(dir).specId, id);
  assert.match(readFileSync(file, 'utf8'), /data-sf-spec-status="implementing"/);

  assert.equal(run('finish', dir, id).status, 0);
  assert.match(readFileSync(file, 'utf8'), /data-sf-spec-status="done"/);
  assert.equal(getActive(dir), null);
});

test('start refuses when the gate fails', () => {
  const { dir, id } = specsDirWith(TEMPLATE); // open question
  const start = run('start', dir, id, '--stage', '1');
  assert.equal(start.status, 1);
  assert.equal(getActive(dir), null, 'no active marker written on a failed gate');
});

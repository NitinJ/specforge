// `specforge actions`, which is how the review skill and a human read the same
// list.
//
// The instruction an agent follows has to come from one place. If the skill
// carried its own copy, improving an instruction would mean editing it in two
// files and noticing when they drifted, which nobody does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'specforge-cli.mjs');

const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('actions prints every action as JSON, and exits 0', () => {
  const out = JSON.parse(run('actions'));
  assert.equal(out.actions.length, 12);
  assert.equal(out.actions[0].id, 'explain_simply');
  assert.ok(out.actions[0].instruction.length > 40, 'the instruction is printed, not just the id');
});

test('actions --scope narrows to one surface', () => {
  const local = JSON.parse(run('actions', '--scope', 'local'));
  const global = JSON.parse(run('actions', '--scope', 'global'));
  assert.equal(local.actions.length + global.actions.length, 12);
  assert.equal(
    global.actions.map((a) => a.id).join(' '),
    'fix_the_naming consistency_pass canonicalize',
  );
});

test('an unknown scope names the ones that exist rather than printing nothing', () => {
  assert.throws(
    () => run('actions', '--scope', 'section'),
    (e) => /scope/.test(String(e.stderr)) && /local/.test(String(e.stderr)),
  );
});

test('actions <id> prints one action', () => {
  const out = JSON.parse(run('actions', 'tighten'));
  assert.equal(out.action.id, 'tighten');
  assert.equal(out.action.kind, 'in-place');
});

test('an unknown id fails rather than printing an empty result', () => {
  // Silence here would read as "that action exists and does nothing", which is
  // the wrong thing for a skill resolving an id out of a comment body.
  assert.throws(
    () => run('actions', 'tightenn'),
    (e) => /tightenn/.test(String(e.stderr)),
  );
});

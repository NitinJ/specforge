// `spec-types-cli` — what the create skill reads before picking a type.
//
// The skill used to choose from a list frozen when it was written. This is how a
// kind the user added reaches it, so the property that matters is that a custom
// kind arrives with the sentence its author wrote about when to use it: without
// that line the skill has a name and no rule, and will keep choosing `general`.
//
// Spec 45395008a2, task 5.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { addCustomType, BUILTIN } from '../lib/spec-types.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'spec-types-cli.mjs');
const store = useTempStore({ beforeEach, afterEach }, 'sf-typescli-');

const run = (...args) => execFileSync('node', [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, SPECFORGE_HOME: store.dir },
});

test('it lists the six built-ins', () => {
  const out = run();
  for (const kind of ['general', 'design', 'research', 'deck', 'design-impl', 'impl']) {
    assert.match(out, new RegExp(`\\b${kind}\\b`), `${kind} is listed`);
  }
});

test('a store with nothing added says so, and says where to add one', () => {
  const out = run();
  assert.match(out, /No types have been added/);
  assert.match(out, /settings\?tab=templates/);
});

test('a custom kind is listed apart, with the sentence its author wrote', () => {
  addCustomType({
    name: 'Postmortem',
    whenToUse: 'an incident is over and we are writing up what went wrong',
    shell: 'doc',
  });
  const out = run();
  assert.match(out, /Added by you:/);
  assert.match(out, /postmortem/);
  assert.match(out, /when to use: an incident is over/,
    'the rule, without which the skill has a name and nothing to decide on');
});

test('the shell family is said in words, not as a flag', () => {
  addCustomType({ name: 'Planned', whenToUse: 'x', shell: 'impl' });
  const out = run();
  assert.match(out, /planned\s+carries an implementation plan/);
  assert.match(out, /design\s+a document/);
});

test('--json carries the records a caller would branch on', () => {
  addCustomType({ name: 'Postmortem', whenToUse: 'after an incident', shell: 'doc' });
  const { types } = JSON.parse(run('--json'));
  assert.equal(types.length, Object.keys(BUILTIN).length + 1);
  const custom = types.find((t) => t.slug === 'postmortem');
  assert.equal(custom.builtin, false);
  assert.equal(custom.whenToUse, 'after an incident');
  assert.equal(types.find((t) => t.slug === 'design').builtin, true);
});

test('a custom kind with no when-to-use still lists, rather than being dropped', () => {
  // Nothing stops a row existing without one, and a kind you cannot see is worse
  // than one you have to guess about.
  addCustomType({ name: 'Bare' });
  const out = run();
  assert.match(out, /bare/);
  assert.equal(/bare\s+a document\s+when to use:/.test(out), false, 'and claims no rule it lacks');
});

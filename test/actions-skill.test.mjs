// The skill and the registry have to agree.
//
// The registry is the one place an instruction lives, and the skill is what
// makes an agent read it. If the skill grows its own copy of the list, an
// instruction improved in one place goes stale in the other and nobody notices,
// because both look right on their own.
//
// So: the skill names every id, and it never restates an instruction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { ALL_ACTIONS } from '../lib/actions/all.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'review-spec', 'SKILL.md'), 'utf8');

test('the skill names every action in the registry', () => {
  const missing = ALL_ACTIONS.filter((a) => !SKILL.includes(`@${a.id}`)).map((a) => a.id);
  assert.deepEqual(missing, [], 'an action the skill does not name is one the agent will not run');
});

test('the skill names no action the registry does not have', () => {
  const known = new Set(ALL_ACTIONS.map((a) => a.id));
  // Only the action-table region: the skill quotes `@agent` and may quote a
  // person's name elsewhere, and neither is an action.
  const table = SKILL.slice(SKILL.indexOf('## Actions'));
  const named = [...table.matchAll(/`@([a-z_]+)`/g)].map((m) => m[1]);
  const strays = [...new Set(named)].filter((n) => n !== 'agent' && !known.has(n));
  assert.deepEqual(strays, [], 'the skill names an action that does not exist');
});

test('the skill does not restate an instruction', () => {
  // A copy here is a copy that goes stale. The skill points at
  // `specforge actions`; the sentences themselves stay in the registry.
  for (const a of ALL_ACTIONS.filter((x) => x.instruction)) {
    const opening = a.instruction.split('.')[0].trim();
    assert.equal(
      SKILL.includes(opening), false,
      `${a.id}'s instruction is pasted into the skill; it should read the registry instead`,
    );
  }
});

test('nor does it restate an action\'s import guidance', () => {
  // Same trap, second field. The guidance reaches the agent on the thread, so a
  // copy here is a second version to keep in step and the one nobody updates.
  for (const a of ALL_ACTIONS.filter((x) => x.importInstruction)) {
    const opening = a.importInstruction.split('.')[0].trim();
    assert.equal(
      SKILL.includes(opening), false,
      `${a.id}'s import guidance is pasted into the skill`,
    );
  }
});

test('the skill says an import depends on what kind of draft it is', () => {
  // Without this the agent reads `@import` as one operation and applies one
  // behaviour to six kinds of content, which is what a merge/replace flag did.
  assert.match(SKILL, /`target`/, 'the field carrying the resolved aside');
  assert.match(SKILL, /guidance/);
  assert.match(SKILL, /cut only what the draft carries forward/i, 'and the rule that holds over all of them');
});

test('the skill tells the agent how to read the registry', () => {
  // The bare command, not a path into the install: the skill has to read the
  // same on every agent CLI, and only one of them expands a plugin-root
  // variable.
  assert.match(SKILL, /specforge actions/, 'the command that prints the list');
});

test('the skill states the rule that decides where output goes', () => {
  assert.match(SKILL, /in-place/);
  assert.match(SKILL, /aside/);
});

test('the skill tells the agent the thread already carries the resolution', () => {
  // The fix for the failure this file's other tests were written after: the
  // expansion is pushed onto the thread now, so the skill's job is to say that
  // rather than to describe a lookup nobody performed.
  assert.match(SKILL, /`actions` array|carries an `actions`/);
  assert.match(SKILL, /`next`/, 'and names the field that says what to do');
  assert.match(SKILL, /`run`/, 'and the one carrying the command');
});

test('the skill points at the command that writes an aside', () => {
  // Prose telling an agent what markup to produce is not a mechanism, and the
  // first real Visualize run proved it by writing its diagram straight into the
  // section. The skill has to name the command, and it must not go back to
  // describing the markup as something to type.
  assert.match(SKILL, /specforge aside/, 'the command');
  assert.match(SKILL, /--section/);
  assert.match(SKILL, /--action/);
  assert.match(SKILL, /[Dd]o not hand-write/, 'and says not to write the markup by hand');
});

test('an aside action is told not to edit the section it came from', () => {
  assert.match(SKILL, /[Dd]o not edit the section the comment sits on/);
});

test('the skill says what to do when a detail is missing', () => {
  // The two actions that cannot run on their instruction alone. Guessing at the
  // claim to check, or at which term to rename, is worse than asking.
  assert.match(SKILL, /needsDetail/);
});

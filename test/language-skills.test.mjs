// The skills tell the agent what to do with the language field.
//
// The payload is worth nothing if nothing instructs the agent to obey it, and
// the skills are the only place that instruction can live: they are what the
// agent reads before it writes. This suite is a guard against the field being
// delivered and silently ignored, which is indistinguishable from the feature
// not existing.
//
// Task 2.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CREATE = read('skills/create-spec/SKILL.md');
const REVIEW = read('skills/review-spec/SKILL.md');

test('create-spec names the language field in the payload it documents', () => {
  assert.match(CREATE, /\blanguage\b[^`]*prompts\s*\}/,
    'the printed shape lists it, so an agent reading the skill expects it');
});

test('create-spec instructs the agent to apply the direction', () => {
  assert.match(CREATE, /authoring direction/i);
  assert.match(CREATE, /Apply it to everything you write/i);
});

test('review-spec names the language field in the payload it documents', () => {
  assert.match(REVIEW, /\{ specId, htmlPath, language, threads, pending \}/);
});

test('review-spec extends the direction to replies and asides', () => {
  // The reach is the decision worth pinning: create-only would leave a spec
  // written in one register and its asides in another.
  assert.match(REVIEW, /replies, amendments, and asides/i);
});

test('both skills say the user’s direction outranks the house contract', () => {
  for (const [name, text] of [['create-spec', CREATE], ['review-spec', REVIEW]]) {
    assert.match(text, /user's direction wins/i, `${name} states the precedence`);
    assert.match(text, /spec-language\.md/, `${name} names the contract it outranks`);
  }
});

test('both skills point at the pane rather than at themselves for setting it', () => {
  for (const [name, text] of [['create-spec', CREATE], ['review-spec', REVIEW]]) {
    assert.match(text, /Configuration pane/i, `${name} says where the setting lives`);
  }
});

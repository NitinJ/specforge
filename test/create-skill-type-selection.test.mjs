// The create skill picks a type from the registry, not from a list in its own text.
//
// The skill used to enumerate the types inline. That was fine at six and is a
// liability at eighteen: a description in the skill is a copy, and the copy is
// what goes stale when a type is added or its when-to-use line is sharpened. A
// stale copy is worse than none, because it reads as authoritative.
//
// What is asserted here is that the skill still routes through the registry, and
// that it does not carry a second list of types that could disagree with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { specTypes, specType } from '../lib/spec-types.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'create-spec', 'SKILL.md'), 'utf8');

test('the skill reads the type list rather than reciting it', () => {
  assert.match(SKILL, /spec-types-cli\.mjs/, 'the skill never runs the type list');
  // Ahead of the authoring sections: a type is chosen before a shell is filled.
  assert.ok(
    SKILL.indexOf('spec-types-cli.mjs') < SKILL.indexOf('## 2.'),
    'the type list is read after the type has already been picked',
  );
});

test('the skill does not carry its own catalogue of the types', () => {
  // The shape that goes stale, and the one the skill used to have:
  //
  //   - **research** — "research / investigate / compare <X>". A findings report.
  //   - **design** — "design / architect <X>": a decision doc, no plan.
  //
  // Mentioning a type by name is fine and useful. A bulleted entry per type,
  // each with its own description, is a second registry, and the two disagree
  // the first time either changes. Checked structurally rather than by text,
  // because a reworded copy drifts exactly as fast as a verbatim one.
  const catalogued = specTypes().filter((slug) => {
    const entry = new RegExp(`^\\s*[-*]\\s+\\*\\*\`?${slug}\`?\\*\\*\\s*[—:-]`, 'm');
    return entry.test(SKILL);
  });
  assert.deepEqual(
    catalogued, [],
    `the skill describes these types itself instead of reading them: ${catalogued.join(', ')}`,
  );
});

test('the duplication check would catch the shape it is about', () => {
  // A guard whose failure mode is never exercised is a guard nobody knows works.
  const withCatalogue = `${SKILL}\n  - **design** — a decision doc, no plan.\n`;
  const entry = /^\s*[-*]\s+\*\*`?design`?\*\*\s*[—:-]/m;
  assert.equal(entry.test(withCatalogue), true, 'the pattern does not match its own example');
  assert.equal(entry.test(SKILL), false);
});

test('the skill still names general as the fallback, and guards it', () => {
  // The one type whose selection rule cannot live in the registry: "only when
  // nothing else fits" is a statement about the other seventeen.
  assert.match(SKILL, /`general` is the fallback/);
  assert.match(SKILL, /never the way to avoid choosing/i);
});

test('the skill tells the agent what to do when two types fit', () => {
  // Picking the first plausible type is the failure mode a long list creates,
  // and the tie-break is what prevents it.
  assert.match(SKILL, /more specific/i);
});

// Seed a store's prompts.json and report what the effective values should be.
//
// Every later suite in this feature needs the same thing: a store carrying a
// known set of customizations, plus the answer key for what the product should
// then do. Hand-writing that JSON per test makes each test its own source of
// truth, which is how an assertion ends up agreeing with a bug. The helper owns
// the shape; a test asserts against `expected` rather than against itself.
//
// Spec 094abd0b9d, task 0.1.

import { writeFileSync } from 'node:fs';
import { promptsPath } from '../../lib/store-paths.mjs';

/**
 * Write a prompts.json into the current test store.
 *
 * @param {object} shape
 * @param {string} [shape.language] the authoring preamble
 * @param {string[]} [shape.hidden] shipped action ids kept out of menus
 * @param {Record<string, {instruction?:string, importInstruction?:string}>} [shape.overrides]
 * @param {object[]} [shape.custom] user-created action definitions
 * @returns {{
 *   language: string,
 *   hidden: string[],
 *   overrides: object,
 *   custom: object[],
 *   customIds: string[],
 *   overriddenIds: string[],
 *   expectsMenuToOmit: (id:string) => boolean,
 *   instructionFor: (id:string) => string|undefined,
 * }} the answer key
 */
export function seedPrompts(shape = {}) {
  const language = shape.language || '';
  const hidden = shape.hidden || [];
  const overrides = shape.overrides || {};
  const custom = shape.custom || [];

  const file = {};
  if (language) file.language = language;
  // Which of the two shapes `language` is in. Omitted seeds the pre-tab shape,
  // a direction added on top of the shipped rules, which is what every store
  // written before the Language tab held the contract carries.
  if (language && shape.languageMode) file.languageMode = shape.languageMode;
  const actions = {};
  if (hidden.length) actions.hidden = hidden;
  if (Object.keys(overrides).length) actions.overrides = overrides;
  if (custom.length) actions.custom = custom;
  if (Object.keys(actions).length) file.actions = actions;

  writeFileSync(promptsPath(), JSON.stringify(file, null, 2));

  return {
    language,
    hidden,
    overrides,
    custom,
    customIds: custom.map((a) => a.id),
    overriddenIds: Object.keys(overrides),
    expectsMenuToOmit: (id) => hidden.includes(id),
    // What the effective instruction should be for an id this seed touched.
    // Undefined for anything it did not, so a test cannot silently assert
    // against a value the seed never set.
    instructionFor(id) {
      if (overrides[id] && overrides[id].instruction) return overrides[id].instruction;
      const made = custom.find((a) => a.id === id);
      return made ? made.instruction : undefined;
    },
  };
}

/** A seed exercising every field at once, for suites that want one of each. */
export const SAMPLE = {
  language: 'Write terse. No metaphors, even in asides.',
  hidden: ['summarize'],
  overrides: { visualize: { instruction: 'Prefer a table unless the content is a graph.' } },
  custom: [{
    id: 'x_glossary',
    label: 'Glossary',
    icon: '📖',
    kind: 'aside',
    scope: 'local',
    group: 'understand',
    instruction: 'Define every term of art in this block, one line each.',
  }],
};

// The prompt-customization store: read, write, reset, and the sanitize that
// stands between a hand-edited file and the rest of the product.
//
// The property this file is really defending: a settings file can be wrong in
// every way a JSON file can be wrong, and none of them may stop SpecForge
// working. Every malformed case below reads as "uncustomized" rather than
// throwing, because the alternative is a daemon that will not serve because of a
// stray comma in a preference.
//
// Spec 094abd0b9d, task 1.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { promptsPath } from '../lib/store-paths.mjs';
import {
  readPrompts, writePrompts, resetPromptClass, deleteCustomAction,
  sanitizePrompts, MAX_INSTRUCTION, PROMPT_CLASSES, DEFAULT_IMPORT_INSTRUCTION,
} from '../lib/store-prompts.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-sp-');

const CUSTOM = {
  id: 'x_glossary',
  label: 'Glossary',
  icon: '📖',
  kind: 'aside',
  scope: 'local',
  instruction: 'Define every term of art in this block.',
};

test('no file reads as no customization', () => {
  assert.deepEqual(readPrompts(), {});
});

test('a malformed file reads as no customization rather than throwing', () => {
  writeFileSync(promptsPath(), '{ not json at all');
  assert.deepEqual(readPrompts(), {});
});

test('a file of the wrong shape reads as no customization', () => {
  writeFileSync(promptsPath(), JSON.stringify(['an', 'array']));
  assert.deepEqual(readPrompts(), {});
});

test('unknown keys are dropped on read', () => {
  writeFileSync(promptsPath(), JSON.stringify({
    language: 'Terse.',
    nonsense: { deeply: 'nested' },
    actions: { hidden: ['summarize'], alsoNonsense: 1 },
  }));
  const got = readPrompts();
  assert.deepEqual(got, { language: 'Terse.', actions: { hidden: ['summarize'] } });
});

test('writePrompts round-trips through readPrompts', () => {
  writePrompts({ language: 'Write terse.' });
  assert.equal(readPrompts().language, 'Write terse.');
});

test('a patch merges into actions rather than replacing them', () => {
  writePrompts({ actions: { custom: [CUSTOM] } });
  writePrompts({ actions: { hidden: ['summarize'] } });
  const got = readPrompts();
  assert.deepEqual(got.actions.hidden, ['summarize']);
  assert.equal(got.actions.custom.length, 1, 'the custom action survived a hidden-only patch');
});

test('an instruction longer than the cap is truncated, not refused', () => {
  const long = 'x'.repeat(MAX_INSTRUCTION + 500);
  writePrompts({ actions: { overrides: { visualize: { instruction: long } } } });
  const got = readPrompts().actions.overrides.visualize.instruction;
  assert.equal(got.length, MAX_INSTRUCTION);
});

test('only instruction and importInstruction survive an override', () => {
  writePrompts({
    actions: {
      overrides: {
        visualize: { instruction: 'V', label: 'Renamed', kind: 'direct', scope: 'global' },
      },
    },
  });
  assert.deepEqual(readPrompts().actions.overrides.visualize, { instruction: 'V' },
    'identity fields of a shipped action are not overridable');
});

test('a custom id without the x_ prefix is refused', () => {
  writePrompts({ actions: { custom: [{ ...CUSTOM, id: 'glossary' }] } });
  assert.equal(readPrompts().actions, undefined, 'nothing was stored');
});

test('a custom id with the prefix but a bad tail is refused', () => {
  writePrompts({ actions: { custom: [{ ...CUSTOM, id: 'x_Has Caps' }] } });
  assert.equal(readPrompts().actions, undefined);
});

test('a custom action without an instruction is refused', () => {
  writePrompts({ actions: { custom: [{ ...CUSTOM, instruction: '  ' }] } });
  assert.equal(readPrompts().actions, undefined, 'a menu entry that says nothing is not stored');
});

test('a duplicate custom id keeps the first definition', () => {
  writePrompts({
    actions: {
      custom: [CUSTOM, { ...CUSTOM, label: 'Second', instruction: 'Different' }],
    },
  });
  const custom = readPrompts().actions.custom;
  assert.equal(custom.length, 1);
  assert.equal(custom[0].label, 'Glossary', 'the later definition did not replace an id in use');
});

test('resetting language leaves actions alone', () => {
  writePrompts({ language: 'Terse.', actions: { hidden: ['summarize'] } });
  const after = resetPromptClass('language');
  assert.equal(after.language, undefined);
  assert.deepEqual(after.actions.hidden, ['summarize']);
});

test('resetting actions leaves language alone', () => {
  writePrompts({ language: 'Terse.', actions: { hidden: ['summarize'], custom: [CUSTOM] } });
  const after = resetPromptClass('actions');
  assert.equal(after.language, 'Terse.');
  assert.equal(after.actions, undefined);
});

test('resetting every class removes the file', () => {
  writePrompts({ language: 'Terse.', actions: { hidden: ['summarize'] } });
  resetPromptClass('language');
  resetPromptClass('actions');
  assert.equal(existsSync(promptsPath()), false,
    'a fully reset store looks the same on disk as one never customized');
});

test('an unknown reset class throws rather than silently doing nothing', () => {
  assert.throws(() => resetPromptClass('sections'), /unknown class/);
  assert.deepEqual(PROMPT_CLASSES, ['language', 'actions']);
});

test('deleting a custom action leaves a tombstone', () => {
  writePrompts({ actions: { custom: [CUSTOM] } });
  const after = deleteCustomAction('x_glossary');
  assert.equal(after.actions.custom, undefined, 'gone from the live list');
  assert.equal(after.actions.tombstones[0].id, 'x_glossary');
  assert.equal(after.actions.tombstones[0].instruction, CUSTOM.instruction,
    'the instruction it last carried is kept, so old comments still resolve');
});

test('a tombstone survives an actions reset', () => {
  writePrompts({ actions: { custom: [CUSTOM] } });
  deleteCustomAction('x_glossary');
  const after = resetPromptClass('actions');
  assert.equal(after.actions.tombstones.length, 1,
    'an id a comment already names keeps resolving whatever the user resets');
});

test('deleting an id that is not custom changes nothing', () => {
  writePrompts({ actions: { hidden: ['summarize'] } });
  const after = deleteCustomAction('visualize');
  assert.deepEqual(after.actions.hidden, ['summarize']);
  assert.equal(after.actions.tombstones, undefined);
});

test('a custom aside action gets a default import instruction', () => {
  // The registry refuses an aside with no importInstruction, and requiring the
  // user to write two instructions to create one action is friction on the field
  // whose purpose is least obvious at creation time.
  writePrompts({ actions: { custom: [CUSTOM] } });
  const got = readPrompts().actions.custom[0];
  assert.equal(got.importInstruction, DEFAULT_IMPORT_INSTRUCTION);
});

test('an author’s own import instruction wins over the default', () => {
  writePrompts({ actions: { custom: [{ ...CUSTOM, importInstruction: 'Mine.' }] } });
  assert.equal(readPrompts().actions.custom[0].importInstruction, 'Mine.');
});

test('an in-place custom action gets no import instruction', () => {
  writePrompts({ actions: { custom: [{ ...CUSTOM, kind: 'in-place' }] } });
  assert.equal(readPrompts().actions.custom[0].importInstruction, undefined,
    'there is no draft to import');
});

test('sanitizePrompts is pure and does not need a store', () => {
  const got = sanitizePrompts({ language: '  padded  ', actions: { hidden: ['a', 'a', 'b'] } });
  assert.equal(got.language, 'padded', 'trimmed');
  assert.deepEqual(got.actions.hidden, ['a', 'b'], 'deduped');
});

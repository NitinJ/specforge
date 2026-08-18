// What the settings page reads and writes.
//
// The page renders effective text beside a marker saying whose it is, and a
// reset has to restore something, so this API carries the shipped values along
// with the customizations rather than letting the page hold its own copy of
// what SpecForge ships with — a copy that would drift the first time an
// instruction was improved.
//
// Task 3.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts, SAMPLE } from './helpers/prompts-store.mjs';
import { handlePromptsGet, handlePromptsPut, handlePromptsReset } from '../lib/prompts-api.mjs';
import { SHIPPED_ACTIONS } from '../lib/actions/all.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-papi-');

const find = (state, id) => state.actions.shipped.concat(state.actions.custom)
  .find((a) => a.id === id);

test('an untouched store reports everything as default', () => {
  const s = handlePromptsGet();
  assert.equal(s.language.value, '');
  assert.equal(s.language.customized, false);
  assert.equal(s.actions.shipped.length, SHIPPED_ACTIONS.length);
  assert.equal(s.actions.custom.length, 0);
  assert.equal(s.actions.shipped.every((a) => !a.customized && !a.hidden), true);
});

test('a shipped action carries both its effective and its shipped text', () => {
  seedPrompts(SAMPLE);
  const v = find(handlePromptsGet(), 'visualize');
  assert.equal(v.instruction, SAMPLE.overrides.visualize.instruction, 'what is in force');
  assert.match(v.shippedInstruction, /Choose the form/, 'and what a reset would restore');
  assert.equal(v.customized, true);
});

test('the groups travel, so the create form need not hardcode them', () => {
  const s = handlePromptsGet();
  assert.ok(s.actions.groups.length >= 3);
  assert.ok(s.actions.groups.every((g) => g.id && g.label));
});

test('hidden is reported per action', () => {
  seedPrompts({ hidden: ['visualize'] });
  assert.equal(find(handlePromptsGet(), 'visualize').hidden, true);
  assert.equal(find(handlePromptsGet(), 'go_deeper').hidden, false);
});

test('a put answers with the new state rather than an ack', () => {
  const s = handlePromptsPut({ language: 'Terse.' });
  assert.equal(s.language.value, 'Terse.', 'the page renders what the store now holds');
  assert.equal(s.language.customized, true);
});

test('resetOverride clears one action and leaves the others', () => {
  handlePromptsPut({
    actions: { overrides: { visualize: { instruction: 'V' }, go_deeper: { instruction: 'G' } } },
  });
  const after = handlePromptsPut({ resetOverride: 'visualize' });
  assert.equal(find(after, 'visualize').customized, false);
  assert.equal(find(after, 'go_deeper').customized, true, 'the other override survived');
});

test('resetOverride restores the shipped text exactly', () => {
  const before = find(handlePromptsGet(), 'visualize').shippedInstruction;
  handlePromptsPut({ actions: { overrides: { visualize: { instruction: 'V' } } } });
  const after = handlePromptsPut({ resetOverride: 'visualize' });
  assert.equal(find(after, 'visualize').instruction, before);
});

test('deleteCustom removes it from the list and keeps its id resolving', async () => {
  handlePromptsPut({ actions: { custom: SAMPLE.custom } });
  const after = handlePromptsPut({ deleteCustom: 'x_glossary' });
  assert.equal(after.actions.custom.length, 0);
  const { actionById } = await import('../lib/actions/all.mjs');
  assert.ok(actionById('x_glossary'), 'an id a comment may already name still answers');
});

test('a class reset answers with the state and clears only that class', () => {
  handlePromptsPut({ language: 'Terse.', actions: { hidden: ['visualize'] } });
  const after = handlePromptsReset('language');
  assert.equal(after.language.value, '');
  assert.equal(find(after, 'visualize').hidden, true, 'actions untouched');
});

test('an unknown reset class throws rather than silently clearing nothing', () => {
  assert.throws(() => handlePromptsReset('sections'), /unknown class/);
});

test('a malformed patch is a no-op rather than a crash', () => {
  handlePromptsPut({ language: 'Terse.' });
  const after = handlePromptsPut(null);
  assert.equal(after.language.value, 'Terse.');
});

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
  assert.equal(s.language.value, s.language.contract, 'the box opens on the shipped rules');
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

test('the shipped contract travels, so the page need not hold a copy of it', () => {
  // It is both what the box opens on and what a reset restores, so the page has
  // to be able to show it either way. A copy in the page would drift the first
  // time the contract was edited.
  const s = handlePromptsGet();
  assert.match(s.language.contract, /Spec language contract/);
  assert.equal(s.language.customized, false);
});

test('an edit is what is in force, and the shipped text still travels beside it', () => {
  seedPrompts({ language: 'Write terse. Nothing else.', languageMode: 'contract' });
  const s = handlePromptsGet();
  assert.equal(s.language.value, 'Write terse. Nothing else.', 'what the agent is told');
  assert.match(s.language.contract, /Spec language contract/, 'and what a reset would restore');
  assert.equal(s.language.customized, true);
});

test('a direction written before the box held the contract keeps the rules around it', () => {
  // The upgrade case. Such a store holds two sentences that were ADDED to the
  // shipped rules. Showing them alone would present them as the complete
  // writing rules, and the next save would make that true.
  seedPrompts({ language: 'Write terse.' });
  const s = handlePromptsGet();
  assert.match(s.language.value, /Spec language contract/, 'the shipped rules are still there');
  assert.match(s.language.value, /Write terse\./, 'and so is the direction');
  assert.ok(s.language.value.indexOf('Write terse.') > s.language.value.indexOf('Register'),
    'the direction comes last, where the more specific instruction wins');
  assert.equal(s.language.customized, true);
});

test('saving over a legacy direction stamps it as the whole contract', () => {
  seedPrompts({ language: 'Write terse.' });
  const composed = handlePromptsGet().language.value;
  handlePromptsPut({ language: `${composed}\n\nAnd never hedge.` });
  const after = handlePromptsGet().language.value;
  // Composed once, not again: a second open must not re-prepend the rules.
  assert.equal(after.match(/Spec language contract/g).length, 1);
  assert.match(after, /And never hedge\./);
});

test('saving the shipped rules back unchanged is not a customization', () => {
  // Otherwise opening the tab and pressing Save freezes a copy that stops
  // tracking the shipped text, and the page calls it customized while it is
  // character for character the default.
  const shipped = handlePromptsGet().language.contract;
  const s = handlePromptsPut({ language: shipped });
  assert.equal(s.language.customized, false);
  assert.equal(s.language.value, shipped);
});

test('the cap holds the whole contract with room to edit inside it', () => {
  // 4,000 was set when the box held a short direction added on top. It now
  // holds the contract itself, and a cap the contract barely fits under is a
  // cap that makes editing impossible.
  const s = handlePromptsGet();
  assert.equal(s.language.max, 12000);
  assert.ok(s.language.max > s.language.contract.length * 2,
    `the cap leaves no room: ${s.language.contract.length} of ${s.language.max}`);
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

test('setOverride merges rather than replacing the whole map', () => {
  // Raised in review of PR #204: a plain patch replaces `overrides` wholesale,
  // so saving one action's text dropped every other action's edits.
  handlePromptsPut({ setOverride: { id: 'visualize', instruction: 'V' } });
  handlePromptsPut({ setOverride: { id: 'go_deeper', instruction: 'G' } });
  const s = handlePromptsGet();
  assert.equal(find(s, 'visualize').instruction, 'V', 'the earlier edit survived');
  assert.equal(find(s, 'go_deeper').instruction, 'G');
});

test('setOverride with every field emptied is a reset', () => {
  handlePromptsPut({ setOverride: { id: 'visualize', instruction: 'V' } });
  const after = handlePromptsPut({ setOverride: { id: 'visualize', instruction: '' } });
  assert.equal(find(after, 'visualize').customized, false);
});

test('setOverride leaves other actions alone when it resets one', () => {
  handlePromptsPut({ setOverride: { id: 'visualize', instruction: 'V' } });
  handlePromptsPut({ setOverride: { id: 'go_deeper', instruction: 'G' } });
  const after = handlePromptsPut({ setOverride: { id: 'visualize', instruction: '' } });
  assert.equal(find(after, 'go_deeper').customized, true);
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
  assert.equal(after.language.customized, false);
  assert.equal(after.language.value, after.language.contract, 'back to the shipped rules');
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

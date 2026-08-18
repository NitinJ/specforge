// The two stage-0 helpers for the configuration feature.
//
// A helper that lies is worse than no helper: every later suite in this feature
// asserts against seedPrompts' answer key, so the key is tested here against a
// hand count, and the page harness is tested for the one property that makes it
// worth having — that the page's own script actually ran.
//
// Spec 094abd0b9d, stage 0.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts, SAMPLE } from './helpers/prompts-store.mjs';
import { loadSettings } from './helpers/settings-dom.mjs';
import { promptsPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-cfg-');

test('seedPrompts writes a file the store can find', () => {
  seedPrompts(SAMPLE);
  assert.ok(existsSync(promptsPath()), 'prompts.json is where store-paths says');
  const raw = JSON.parse(readFileSync(promptsPath(), 'utf8'));
  assert.equal(raw.language, SAMPLE.language);
  assert.deepEqual(raw.actions.hidden, ['summarize']);
  assert.equal(raw.actions.custom[0].id, 'x_glossary');
});

test('the answer key matches a hand count', () => {
  const seed = seedPrompts({
    overrides: { visualize: { instruction: 'V' }, go_deeper: { instruction: 'G' } },
    hidden: ['summarize', 'copy_link'],
    custom: [
      { id: 'x_a', label: 'A', kind: 'aside', scope: 'local', instruction: 'AA' },
      { id: 'x_b', label: 'B', kind: 'aside', scope: 'local', instruction: 'BB' },
      { id: 'x_c', label: 'C', kind: 'aside', scope: 'local', instruction: 'CC' },
    ],
  });
  assert.equal(seed.overriddenIds.length, 2);
  assert.equal(seed.hidden.length, 2);
  assert.equal(seed.customIds.length, 3);
  assert.deepEqual(seed.customIds, ['x_a', 'x_b', 'x_c']);
});

test('instructionFor answers for overrides and customs, and only for them', () => {
  const seed = seedPrompts(SAMPLE);
  assert.equal(seed.instructionFor('visualize'), SAMPLE.overrides.visualize.instruction);
  assert.equal(seed.instructionFor('x_glossary'), SAMPLE.custom[0].instruction);
  assert.equal(seed.instructionFor('go_deeper'), undefined,
    'a seed that did not touch an id must not answer for it');
});

test('expectsMenuToOmit names the hidden ids', () => {
  const seed = seedPrompts({ hidden: ['summarize'] });
  assert.equal(seed.expectsMenuToOmit('summarize'), true);
  assert.equal(seed.expectsMenuToOmit('visualize'), false);
});

test('an empty seed writes an empty object rather than junk', () => {
  seedPrompts();
  assert.deepEqual(JSON.parse(readFileSync(promptsPath(), 'utf8')), {});
});

test('the settings harness runs the page’s own script', (t) => {
  // The property worth testing: the theme button is empty in the served HTML and
  // filled by the page's script. If runScripts were off, this would be ''.
  const { window } = loadSettings(t, {}, { scheme: 'dark' });
  const btn = window.document.getElementById('sf-theme');
  assert.ok(btn, 'the page has a theme button');
  assert.match(btn.innerHTML, /svg/, 'and its script painted an icon into it');
});

test('the settings harness stubs fetch before parsing', (t) => {
  const { window, calls } = loadSettings(t, {});
  assert.equal(typeof window.fetch, 'function');
  assert.deepEqual(calls, [], 'the shell issues no requests of its own yet');
});

test('the harness opens the tab the options name', (t) => {
  const { window } = loadSettings(t, { tab: 'actions' });
  assert.equal(window.document.getElementById('sf-tabpanel').getAttribute('data-tab'), 'actions');
  const on = window.document.querySelector('.tab.on');
  assert.equal(on.getAttribute('data-tab'), 'actions');
});

test('an unknown tab falls back to the first rather than rendering nothing', (t) => {
  const { window } = loadSettings(t, { tab: 'nonsense' });
  assert.equal(window.document.getElementById('sf-tabpanel').getAttribute('data-tab'), 'language');
});

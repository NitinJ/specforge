// The registry as the user has it: shipped actions plus their customizations.
//
// The merge lives inside all.mjs's existing exports, so what is really under
// test here is that every consumer inherits customization without knowing about
// it. The distinction the suite exists to pin: hiding is a MENU decision and
// resolution keeps answering, because an id inside a comment sent months ago has
// to mean something today whatever the menu now looks like.
//
// Spec 094abd0b9d, task 1.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts, SAMPLE } from './helpers/prompts-store.mjs';
import {
  allActions, actionById, menuActions, forScope, SHIPPED_ACTIONS,
} from '../lib/actions/all.mjs';
import { deleteCustomAction, writePrompts } from '../lib/store-prompts.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-ae-');

test('with nothing customized the effective set is the shipped set', () => {
  assert.equal(allActions().length, SHIPPED_ACTIONS.length);
  assert.equal(menuActions().length, SHIPPED_ACTIONS.length);
});

test('an override replaces the instruction and nothing else', () => {
  const seed = seedPrompts(SAMPLE);
  const shipped = SHIPPED_ACTIONS.find((a) => a.id === 'visualize');
  const got = actionById('visualize');
  assert.equal(got.instruction, seed.instructionFor('visualize'));
  assert.equal(got.label, shipped.label, 'the label is identity, not text');
  assert.equal(got.kind, shipped.kind);
  assert.equal(got.scope, shipped.scope);
});

test('an override does not leak into the shipped list', () => {
  seedPrompts(SAMPLE);
  actionById('visualize');
  const shipped = SHIPPED_ACTIONS.find((a) => a.id === 'visualize');
  assert.doesNotMatch(shipped.instruction, /Prefer a table/,
    'the settings page needs the shipped text to show what a reset restores');
});

test('a hidden action leaves the menu', () => {
  seedPrompts({ hidden: ['visualize'] });
  assert.equal(menuActions().some((a) => a.id === 'visualize'), false);
});

test('a hidden action still resolves', () => {
  // The promise the whole id-not-instruction rule rests on: a comment carrying
  // @visualize from before the user hid it must still mean something.
  seedPrompts({ hidden: ['visualize'] });
  const got = actionById('visualize');
  assert.ok(got, 'resolution is not menu visibility');
  assert.equal(got.id, 'visualize');
});

test('a hidden action leaves forScope too', () => {
  const before = forScope('local').length;
  seedPrompts({ hidden: ['visualize'] });
  assert.equal(forScope('local').length, before - 1);
});

test('a custom action joins the menu and resolves', () => {
  const seed = seedPrompts(SAMPLE);
  assert.equal(menuActions().some((a) => a.id === 'x_glossary'), true);
  assert.equal(actionById('x_glossary').instruction, seed.instructionFor('x_glossary'));
});

test('a custom action carries its declared kind, scope and group', () => {
  seedPrompts(SAMPLE);
  const got = actionById('x_glossary');
  assert.equal(got.kind, 'aside');
  assert.equal(got.scope, 'local');
  assert.equal(got.group, 'understand');
});

test('a deleted custom action leaves the menu but keeps resolving', () => {
  writePrompts({ actions: { custom: SAMPLE.custom } });
  assert.equal(menuActions().some((a) => a.id === 'x_glossary'), true);
  deleteCustomAction('x_glossary');
  assert.equal(menuActions().some((a) => a.id === 'x_glossary'), false, 'gone from the menu');
  const got = actionById('x_glossary');
  assert.ok(got, 'and still answers, from its tombstone');
  assert.equal(got.instruction, SAMPLE.custom[0].instruction);
});

test('an unknown id resolves to null, customized or not', () => {
  assert.equal(actionById('no_such_action'), null);
  seedPrompts(SAMPLE);
  assert.equal(actionById('no_such_action'), null);
});

test('a custom entry the registry refuses is dropped, not thrown', () => {
  // The store sanitized it and this module still refuses it, which means the two
  // disagree. A settings file must not be able to break the menu.
  seedPrompts({ custom: [{ id: 'x_bad', label: 'Bad', icon: '?', kind: 'aside', scope: 'local', instruction: 'i', group: 'nonexistent-group' }] });
  const menu = menuActions();
  assert.equal(menu.some((a) => a.id === 'x_bad'), false);
  assert.ok(menu.length >= SHIPPED_ACTIONS.length - 1, 'the rest of the menu survived');
});

test('menuActions still withholds instructions', () => {
  seedPrompts(SAMPLE);
  for (const a of menuActions()) {
    assert.equal(a.instruction, undefined,
      'the client resolves ids; shipping prose to it would let a copy drift');
  }
});

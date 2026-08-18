// The authoring preamble reaching the agent.
//
// Language direction is the one axis with no delivery path before this feature:
// the shipped contract is prose in the plugin, and nothing read a user's
// extension of it. These two payloads are that path. The reach is deliberate:
// the preamble travels with the language contract, which already governs
// creating a spec, replying in review, and writing an aside, so a register that
// changed between the spec body and its asides would read as two authors
// (spec 094abd0b9d, D8).
//
// Task 2.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts } from './helpers/prompts-store.mjs';
import { cmdCreate, cmdComments } from '../lib/specforge-cli.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-lang-');

const PREAMBLE = 'Write terse. No metaphors, even in asides.';
const deps = { ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/' }), session: '' };

test('create carries the preamble when one is set', async () => {
  seedPrompts({ language: PREAMBLE });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, PREAMBLE);
});

test('create carries an empty preamble when none is set', async () => {
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, '', 'the field is always present, so a reader need not test for it');
});

test('create still carries its section prompts beside the preamble', async () => {
  seedPrompts({ language: PREAMBLE });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.ok(Array.isArray(out.prompts), 'the two are separate payloads');
  assert.equal(out.language, PREAMBLE);
});

test('comments carries the preamble', async () => {
  seedPrompts({ language: PREAMBLE });
  const { id } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  const out = await cmdComments({ id });
  assert.equal(out.language, PREAMBLE,
    'a reply and an aside are written under the same contract as the spec body');
});

test('comments carries an empty preamble when none is set', async () => {
  const { id } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  const out = await cmdComments({ id });
  assert.equal(out.language, '');
});

test('the preamble is trimmed and capped on the way through', async () => {
  seedPrompts({ language: `   ${PREAMBLE}   ` });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, PREAMBLE, 'whitespace a textarea leaves behind does not travel');
});

test('a malformed prompts file leaves both payloads working', async () => {
  const { writeFileSync } = await import('node:fs');
  const { promptsPath } = await import('../lib/store-paths.mjs');
  writeFileSync(promptsPath(), 'not json');
  const { id, language } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(language, '');
  assert.equal((await cmdComments({ id })).language, '');
});

// The writing contract reaching the agent.
//
// `language` on these payloads is the contract in force, whole. It used to be
// the user's addition to a contract the authoring skills read from the plugin
// themselves, and that stopped working the moment the Language tab became
// editable: a rule the user deleted was still in the file the skill read, and
// an absence is not a disagreement, so nothing was there to win against it. The
// skills now read the contract from here and nowhere else, which is what makes
// the tab's promise true.
//
// The reach is deliberate: the contract governs creating a spec, replying in
// review, and writing an aside, so a register that changed between the spec
// body and its asides would read as two authors (spec 094abd0b9d, D8).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts } from './helpers/prompts-store.mjs';
import { cmdCreate, cmdComments } from '../lib/specforge-cli.mjs';
import { shippedLanguageContract } from '../lib/language-contract.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-lang-');

const PREAMBLE = 'Write terse. No metaphors, even in asides.';
const OURS = '# Our rules\n\nWrite terse. Never hedge.';
const deps = { ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/' }), session: '' };

test('create carries the shipped contract when nothing is customized', async () => {
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, shippedLanguageContract(),
    'the agent is handed the rules it must follow, not a diff against a file');
});

test('create carries an edited contract instead of the shipped one', async () => {
  seedPrompts({ language: OURS, languageMode: 'contract' });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, OURS);
});

test('a rule deleted in the pane is not delivered from the file behind it', async () => {
  // The defect this file exists to pin. Deleting a rule has to delete it for
  // the agent, or the tab is telling the user something untrue.
  const without = shippedLanguageContract().replace(/^.*em dash.*$/gim, '');
  seedPrompts({ language: without, languageMode: 'contract' });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(/em dash/i.test(out.language), false);
});

test('a direction from before the tab held the contract keeps the rules with it', async () => {
  seedPrompts({ language: PREAMBLE });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.match(out.language, /Spec language contract/, 'the shipped rules travel');
  assert.match(out.language, /No metaphors/, 'and so does the direction');
});

test('create still carries its section prompts beside the contract', async () => {
  seedPrompts({ language: PREAMBLE });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.ok(Array.isArray(out.prompts), 'the two are separate payloads');
  assert.match(out.language, /No metaphors/);
});

test('comments carries the contract', async () => {
  seedPrompts({ language: OURS, languageMode: 'contract' });
  const { id } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  const out = await cmdComments({ id });
  assert.equal(out.language, OURS,
    'a reply and an aside are written under the same contract as the spec body');
});

test('comments carries the shipped contract when nothing is customized', async () => {
  const { id } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  const out = await cmdComments({ id });
  assert.equal((await cmdComments({ id })).language, shippedLanguageContract());
  assert.ok(out.language.length > 0);
});

test('the contract is trimmed on the way through', async () => {
  seedPrompts({ language: `   ${OURS}   `, languageMode: 'contract' });
  const out = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(out.language, OURS, 'whitespace a textarea leaves behind does not travel');
});

test('import-md carries the contract, because converting re-authors', async () => {
  // Raised in review of PR #203: convert runs a deterministic pass and then the
  // agent improves the result, which is authoring. Without this the converted
  // spec would come out in the house register while every other spec came out
  // in the user's.
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  seedPrompts({ language: OURS, languageMode: 'contract' });
  const dir = mkdtempSync(join(tmpdir(), 'sf-md-'));
  const md = join(dir, 'doc.md');
  writeFileSync(md, '# A converted document\n\nSome prose.\n');
  const { cmdImportMd } = await import('../lib/specforge-cli.mjs');
  const out = await cmdImportMd({ file: md }, deps);
  assert.equal(out.language, OURS);
});

test('import carries the contract too', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  seedPrompts({ language: OURS, languageMode: 'contract' });
  const dir = mkdtempSync(join(tmpdir(), 'sf-html-'));
  const file = join(dir, 'doc.html');
  writeFileSync(file, '<!DOCTYPE html><html><body><h1>Doc</h1></body></html>');
  const { cmdImport } = await import('../lib/specforge-cli.mjs');
  const out = await cmdImport({ file }, deps);
  assert.equal(out.language, OURS);
});

test('a malformed prompts file still delivers a contract', async () => {
  // A settings file must never be able to leave the agent with no writing rules
  // at all, which is what an empty string here would mean now.
  const { writeFileSync } = await import('node:fs');
  const { promptsPath } = await import('../lib/store-paths.mjs');
  writeFileSync(promptsPath(), 'not json');
  const { id, language } = await cmdCreate({ title: 'T', type: 'design' }, deps);
  assert.equal(language, shippedLanguageContract());
  assert.equal((await cmdComments({ id })).language, shippedLanguageContract());
});

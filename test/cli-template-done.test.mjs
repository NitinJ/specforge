// `specforge template-done` — how the skill reports back.
//
// Unlike export-done there is no url: what the skill produced is the template
// spec's own HTML, already on disk. Success is the absence of an error, so
// --error is the only flag.
//
// Spec 45395008a2, task 2.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession } from './helpers/live-session.mjs';
import { cmdTemplateDone, COMMANDS } from '../lib/specforge-cli.mjs';
import { requestGenerate } from '../lib/store-generate.mjs';
import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { addCustomType } from '../lib/spec-types.mjs';
import { ensureTemplates, templateId } from '../lib/store-templates.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-tpldone-');

function seedPending(name = 'Postmortem') {
  const { id: sessionId } = seedLiveSession();
  const kind = addCustomType({ name });
  ensureTemplates();
  const specId = templateId(kind.slug);
  attach(specId, sessionId);
  requestGenerate(specId, 'what happened, impact');
  return specId;
}

test('reporting success marks it done', async () => {
  const specId = seedPending();
  const out = await cmdTemplateDone({ id: specId });
  assert.equal(out.ok, true);
  assert.equal(out.generate.state, 'done');
  assert.equal(readMeta(specId).generate.state, 'done');
});

test('reporting a failure keeps the message', async () => {
  const specId = seedPending();
  const out = await cmdTemplateDone({ id: specId, error: 'could not lint the result' });
  assert.equal(out.generate.state, 'error');
  assert.match(readMeta(specId).generate.error, /could not lint/);
});

test('the prompt survives either outcome', async () => {
  // It is the only record of how the template was asked for once the form is
  // gone, and the user may want to see it when refining by hand.
  const specId = seedPending();
  await cmdTemplateDone({ id: specId });
  assert.match(readMeta(specId).generate.prompt, /what happened/);
});

test('no id is an error, not a silent no-op', async () => {
  await assert.rejects(() => cmdTemplateDone({}), /required/);
});

test('an unknown id is an error', async () => {
  await assert.rejects(() => cmdTemplateDone({ id: 'never-existed' }), /unknown spec/);
});

test('the command is dispatchable, with --error as its only flag', async () => {
  const specId = seedPending();
  const out = await COMMANDS['template-done']([specId], { error: 'nope' });
  assert.equal(out.generate.state, 'error');
});

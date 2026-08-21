// The hooks surfacing a template waiting to be written.
//
// A generation request only reaches Claude if a hook says so, and it must say so
// once: a second surface re-runs the skill over a template the user may already
// have edited (I5). It sits after review batches, because a submitted batch is
// someone waiting on a reply, and before exports, because the user creating a
// template is watching a dialog right now.
//
// Spec 45395008a2, task 2.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession } from './helpers/live-session.mjs';
import { run as runStop } from '../hooks/stop.mjs';
import { run as runPrompt } from '../hooks/user-prompt-submit.mjs';
import { requestGenerate, finishGenerate } from '../lib/store-generate.mjs';
import { requestExport } from '../lib/store-export.mjs';
import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { addCustomType } from '../lib/spec-types.mjs';
import { ensureTemplates, templateId } from '../lib/store-templates.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-hookgen-');

const SESSION = 'sess-hooks-0001';
const env = { CLAUDE_CODE_SESSION_ID: SESSION };

/** A template spec of a custom kind, attached to SESSION, with a request on it. */
function seedPending(name = 'Postmortem', prompt = 'what happened, impact, root cause') {
  seedLiveSession({ id: SESSION });
  const kind = addCustomType({ name });
  ensureTemplates();
  const specId = templateId(kind.slug);
  attach(specId, SESSION);
  requestGenerate(specId, prompt);
  return specId;
}

test('Stop blocks and names the template, the skill and the prompt', () => {
  const specId = seedPending('Postmortem', 'what happened, impact, root cause');
  const decision = runStop({}, env);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /template-postmortem/);
  assert.match(decision.reason, /generate-template/);
  assert.match(decision.reason, /what happened, impact, root cause/, 'the prompt rides along');
  assert.equal(readMeta(specId).generate.state, 'working', 'surfacing advances it');
});

test('a second settle does not surface it again (I5)', () => {
  seedPending();
  runStop({}, env);
  const second = runStop({}, env);
  // Whatever the second settle does, it must not be another generation nudge.
  assert.equal(/generate-template/.test((second && second.reason) || ''), false);
});

test('the prompt hook surfaces it as context rather than blocking', () => {
  const specId = seedPending();
  const out = runPrompt({}, env);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /generate-template/);
  assert.equal(readMeta(specId).generate.state, 'working');
});

test('a session owning nothing is untouched', () => {
  assert.equal(runStop({}, { CLAUDE_CODE_SESSION_ID: 'sess-idle' }), null);
  assert.equal(runPrompt({}, { CLAUDE_CODE_SESSION_ID: 'sess-idle' }), null);
});

test('a template already written surfaces nothing', () => {
  const specId = seedPending();
  finishGenerate(specId);
  const decision = runStop({}, env);
  assert.equal(/generate-template/.test((decision && decision.reason) || ''), false);
  assert.equal(readMeta(specId).generate.state, 'done', 'and the hook did not reopen it');
});

test('generation is surfaced before an export, because someone is watching a dialog', () => {
  // An export lands in a Google Doc the user opens later. A template creation
  // has a person in front of a spinner with a stated ETA.
  const specId = seedPending();
  requestExport(specId);
  const decision = runStop({}, env);
  assert.match(decision.reason, /generate-template/);
  assert.equal(/Google Doc/.test(decision.reason), false);
});

test('the stop-hook loop guard still wins', () => {
  seedPending();
  assert.equal(runStop({ stop_hook_active: true }, env), null);
});

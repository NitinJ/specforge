// The template-generation relay: a prompt travels to a Claude session and a
// written template comes back.
//
// The daemon runs no model (E2), so this carries the request and the result and
// nothing else. Same state machine as the Google Docs export it is modelled on:
// requested -> working -> done | error, one-shot, stamped on the template
// spec's meta so it reaches the browser on the poll the page already makes.
//
// Spec 45395008a2, task 2.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession } from './helpers/live-session.mjs';
import {
  requestGenerate, generateRequestsForSession, markGenerateWorking, finishGenerate, generateReason,
} from '../lib/store-generate.mjs';
import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { addCustomType } from '../lib/spec-types.mjs';
import { ensureTemplates, templateId } from '../lib/store-templates.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-generate-');

/** A custom kind with its template spec seeded and attached to a live session. */
function seedPending(name = 'Postmortem', prompt = 'sections: what happened, impact') {
  const { id } = seedLiveSession();
  const kind = addCustomType({ name });
  ensureTemplates();
  const specId = templateId(kind.slug);
  attach(specId, id);
  requestGenerate(specId, prompt);
  return { sessionId: id, specId, slug: kind.slug };
}

// --- the state machine ------------------------------------------------------

test('a request starts at requested and keeps the prompt', () => {
  const { specId } = seedPending('Postmortem', 'what happened, timeline, impact');
  const { generate } = readMeta(specId);
  assert.equal(generate.state, 'requested');
  assert.equal(generate.prompt, 'what happened, timeline, impact');
  assert.equal(typeof generate.requestedAt, 'string');
});

test('requested advances to working, and only once', () => {
  const { specId } = seedPending();
  assert.equal(markGenerateWorking(specId), true);
  assert.equal(readMeta(specId).generate.state, 'working');
  // I5: a second surface must not re-run the skill over a template the user has
  // since edited. The export relay draws the line the same way.
  assert.equal(markGenerateWorking(specId), false, 'a second call is a no-op');
});

test('working finishes done, and the prompt survives', () => {
  // The record of how a template was asked for outlives the request: it is the
  // only place the original wording exists once the form is gone.
  const { specId } = seedPending('Postmortem', 'the original wording');
  markGenerateWorking(specId);
  const generate = finishGenerate(specId);
  assert.equal(generate.state, 'done');
  assert.equal(generate.prompt, 'the original wording');
  assert.equal(typeof generate.at, 'string');
});

test('a failure is recorded with its message, not swallowed', () => {
  const { specId } = seedPending();
  markGenerateWorking(specId);
  const generate = finishGenerate(specId, { error: 'the model returned nothing usable' });
  assert.equal(generate.state, 'error');
  assert.match(generate.error, /nothing usable/);
});

test('finishing without going through working still works', () => {
  // The skill may report before any hook advanced the state, and refusing that
  // would lose a result that already exists.
  const { specId } = seedPending();
  assert.equal(finishGenerate(specId).state, 'done');
});

test('an unknown spec throws rather than writing a meta for it', () => {
  assert.throws(() => requestGenerate('never-existed', 'x'), /unknown spec/);
  assert.throws(() => finishGenerate('never-existed'), /unknown spec/);
  assert.equal(markGenerateWorking('never-existed'), false, 'but advancing one is a quiet no-op');
});

test('an empty prompt is refused: there is nothing to generate from', () => {
  const { id } = seedLiveSession();
  const kind = addCustomType({ name: 'Empty' });
  ensureTemplates();
  const specId = templateId(kind.slug);
  attach(specId, id);
  assert.throws(() => requestGenerate(specId, '   '), /prompt/);
  assert.equal(readMeta(specId).generate, undefined, 'and nothing is stamped');
});

// --- what the session is shown ----------------------------------------------

test('a session is shown its own pending requests and nobody else\'s', () => {
  const mine = seedPending('Mine');
  const { id: other } = seedLiveSession({ id: 'sess-other' });
  const theirs = addCustomType({ name: 'Theirs' });
  ensureTemplates();
  attach(templateId(theirs.slug), other);
  requestGenerate(templateId(theirs.slug), 'their prompt');

  const pending = generateRequestsForSession(mine.sessionId);
  assert.deepEqual(pending.map((m) => m.id), [mine.specId]);
});

test('a request already working is not pending again', () => {
  const { sessionId, specId } = seedPending();
  markGenerateWorking(specId);
  assert.deepEqual(generateRequestsForSession(sessionId), []);
});

test('a finished request is not pending', () => {
  const { sessionId, specId } = seedPending();
  finishGenerate(specId);
  assert.deepEqual(generateRequestsForSession(sessionId), []);
});

test('a session owning nothing is shown nothing', () => {
  assert.deepEqual(generateRequestsForSession('sess-empty'), []);
  assert.deepEqual(generateRequestsForSession(''), []);
});

test('the instruction names each spec and how to report back', () => {
  const { sessionId } = seedPending('Postmortem');
  const reason = generateReason(generateRequestsForSession(sessionId));
  assert.match(reason, /template-postmortem/, 'the spec to write');
  assert.match(reason, /generate-template/, 'the skill to run');
  assert.match(reason, /template-done/, 'and how to report the result');
});

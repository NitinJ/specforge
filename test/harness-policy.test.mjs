// The review loop's decision making, with no harness in sight.
//
// This is the whole of what the three hooks used to hold. It is asserted through
// a fake harness rather than a real one, which is the point: the same decisions
// have to be reachable from any agent CLI, and a test that needed Claude Code
// installed would prove the opposite (E6, I7).
//
// Spec e9ddcddef6, stage 3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { fakeHarness, throwingHarness } from './helpers/fake-harness.mjs';
import { seedSession } from './helpers/live-session.mjs';
import { onEvent, EVENTS } from '../lib/harness/policy.mjs';
import { toHookOutput } from '../hooks/lib/emit.mjs';
import { attach } from '../lib/attach.mjs';
import { createSpec } from '../lib/store.mjs';
import { mutateComments } from '../lib/store-comments.mjs';
import { createThread } from '../lib/comments.mjs';
import { submitBatch } from '../lib/store-inbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

useTempStore({ beforeEach, afterEach }, 'sf-policy-');

const anchor = { block: { index: 1, tag: 'P', text: 'a paragraph' } };

/** A session owning one spec, with a live or dead watcher. */
function owning({ alive = true, harness = 'claude' } = {}) {
  const s = seedSession({ id: 'sess-p', harness, alive });
  const specId = createSpec({ title: 'A spec', html: '<h1>A</h1><p>a paragraph</p>' });
  attach(specId, s.key);
  return { ...s, specId };
}

/** A submitted review batch on that spec. */
function withBatch(specId) {
  mutateComments(specId, (store) =>
    createThread(store, { anchor, body: '@agent look at this', author: 'nitin' }));
  return submitBatch(specId);
}

const ctxFor = (key, over = {}) => ({
  harness: fakeHarness({ id: 'fake', sessionKey: key, workRef: (w) => `FAKE(${w})`, ...over }),
  session: key,
});

// --- the idle path ----------------------------------------------------------

test('a session that owns nothing says nothing, on every event', () => {
  for (const event of EVENTS) {
    assert.equal(onEvent(event, ctxFor('claude:nobody')), null, event);
  }
});

test('a context with no session says nothing', () => {
  const ctx = { harness: fakeHarness({ sessionKey: '' }) };
  for (const event of EVENTS) assert.equal(onEvent(event, ctx), null, event);
});

test('an unknown event says nothing rather than throwing', () => {
  const { key } = owning();
  assert.equal(onEvent('not_an_event', ctxFor(key)), null);
});

// --- session_start ----------------------------------------------------------

test('a session that owns specs is told to arm a watcher when it starts', () => {
  const { key, specId } = owning();
  const n = onEvent('session_start', ctxFor(key));
  assert.match(n.text, /owns 1 spec/);
  assert.match(n.text, /wait-batch/);
  assert.equal(n.mustAct, false, 'starting a session is not the moment to refuse anything');
  assert.ok(specId);
});

test('the work reference in that text comes from the harness', () => {
  // The assertion that makes this harness-neutral: no `specforge:` anywhere.
  const { key } = owning();
  const n = onEvent('session_start', ctxFor(key));
  assert.match(n.text, /FAKE\(review-spec\)/);
  assert.doesNotMatch(n.text, /specforge:review-spec/);
});

// --- turn_start -------------------------------------------------------------

test('a pending batch is surfaced on a turn, without refusing it', () => {
  const { key, specId } = owning();
  withBatch(specId);
  const n = onEvent('turn_start', ctxFor(key));
  assert.match(n.text, /review batch\(es\) submitted/);
  assert.equal(n.mustAct, false, 'a turn the user just started is theirs to spend');
});

test('a turn with no queued work says nothing', () => {
  const { key } = owning();
  assert.equal(onEvent('turn_start', ctxFor(key)), null);
});

// --- turn_settled -----------------------------------------------------------

test('a pending batch refuses the settle', () => {
  const { key, specId } = owning();
  withBatch(specId);
  const n = onEvent('turn_settled', ctxFor(key));
  assert.match(n.text, /review batch\(es\) submitted/);
  assert.equal(n.mustAct, true);
});

test('a session settling with no watcher is refused, and told to arm one', () => {
  const { key } = owning({ alive: false });
  const n = onEvent('turn_settled', ctxFor(key));
  assert.match(n.text, /nobody watching them/);
  assert.equal(n.mustAct, true);
});

test('a session with a live watcher and no work settles quietly', () => {
  const { key } = owning({ alive: true });
  assert.equal(onEvent('turn_settled', ctxFor(key)), null);
});

test('a settle that already followed a Notice says nothing (the loop guard)', () => {
  // Claude Code answers this in its payload; Pi's adapter tracks it itself.
  // Policy asks the harness rather than reading either.
  const { key, specId } = owning({ alive: false });
  withBatch(specId);
  const ctx = ctxFor(key, { reentered: true });
  assert.equal(onEvent('turn_settled', ctx), null);
});

// --- ordering ---------------------------------------------------------------

test('a review batch outranks the missing watcher', () => {
  // Both are true at once for a session that has just been handed work by a
  // watcher that then exited. The batch is the thing to do first.
  const { key, specId } = owning({ alive: false });
  withBatch(specId);
  assert.match(onEvent('turn_settled', ctxFor(key)).text, /review batch/);
});

// --- fail-safe (I5) ---------------------------------------------------------

test('a harness whose resolvers throw produces no Notice, not an error', () => {
  for (const event of EVENTS) {
    assert.equal(onEvent(event, { harness: throwingHarness() }), null, event);
  }
});

// --- the Claude Code translation --------------------------------------------

test('a Notice the agent may ignore becomes additionalContext', () => {
  const out = toHookOutput('turn_start', 'UserPromptSubmit', { text: 'hello', mustAct: false });
  assert.deepEqual(out, {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'hello' },
  });
});

test('a Notice the agent must act on becomes a block decision', () => {
  const out = toHookOutput('turn_settled', 'Stop', { text: 'do this', mustAct: true });
  assert.deepEqual(out, { decision: 'block', reason: 'do this' });
});

test('no Notice becomes no output at all', () => {
  assert.equal(toHookOutput('turn_settled', 'Stop', null), null);
});

// --- I7: policy names no harness --------------------------------------------

test('policy.mjs contains no harness name', () => {
  // The seam has leaked if it does, and E1 stops holding. Checked here as well
  // as by the coupling scan in CI, because this is the file it matters for.
  const src = readFileSync(join(ROOT, 'lib', 'harness', 'policy.mjs'), 'utf8');
  for (const name of ['claude', 'Claude', 'pi:', 'codex', 'gemini', 'CLAUDE_']) {
    assert.doesNotMatch(src, new RegExp(name), `policy names ${name}`);
  }
});

test('policy.mjs mentions no Claude Code hook vocabulary', () => {
  const src = readFileSync(join(ROOT, 'lib', 'harness', 'policy.mjs'), 'utf8');
  for (const word of ['hookSpecificOutput', 'stop_hook_active', 'SessionStart', 'UserPromptSubmit']) {
    assert.doesNotMatch(src, new RegExp(word), `policy names ${word}`);
  }
});

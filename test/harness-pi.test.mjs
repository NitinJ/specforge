// The Pi adapter and its binding, with Pi not installed.
//
// Nothing here imports Pi. The adapter is five pure resolvers, and the binding
// is asserted against a recording stand-in, because what the binding has to get
// right is which event it registers for and what options it passes (E6).
//
// Spec e9ddcddef6, stage 5.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { fakePi, fakePiContext } from './helpers/fake-pi.mjs';
import { seedSession } from './helpers/live-session.mjs';
import { pi, detect as detectPi } from '../lib/harness/pi.mjs';
import { currentHarness, harnessById, agentNames } from '../lib/harness/index.mjs';
import { register } from '../extensions/specforge.mjs';
import { attach } from '../lib/attach.mjs';
import { createSpec } from '../lib/store.mjs';
import { mutateComments } from '../lib/store-comments.mjs';
import { createThread } from '../lib/comments.mjs';
import { submitBatch } from '../lib/store-inbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

useTempStore({ beforeEach, afterEach }, 'sf-pi-');

const anchor = { block: { index: 1, tag: 'P', text: 'a paragraph' } };

/** A Pi session owning one spec, with a live or dead watcher. */
function owning({ alive = true, id = 'pi-uuid-1' } = {}) {
  const s = seedSession({ id, harness: 'pi', alive });
  const specId = createSpec({ title: 'A spec', html: '<h1>A</h1><p>a paragraph</p>' });
  attach(specId, s.key);
  return { ...s, specId };
}

function withBatch(specId) {
  mutateComments(specId, (store) =>
    createThread(store, { anchor, body: '@agent look at this', author: 'nitin' }));
  return submitBatch(specId);
}

// --- detection --------------------------------------------------------------

test('Pi is detected by either process marker, or by its session variable', () => {
  for (const env of [{ PI_CODING_AGENT: 'true' }, { AI_AGENT: 'pi' }, { PI_SESSION_ID: 'x' }]) {
    assert.equal(detectPi(env), true, JSON.stringify(env));
    assert.equal(currentHarness(env).id, 'pi', JSON.stringify(env));
  }
});

test('a Claude Code environment is not Pi', () => {
  assert.equal(detectPi({ CLAUDECODE: '1', AI_AGENT: 'claude-code_2-1-245_agent' }), false);
});

test('Pi wins over a stale Claude Code variable inherited from a parent shell', () => {
  // The reason Claude Code is last in the registry: it is also the fallback, so
  // a detector that ran first would claim this session.
  const env = { PI_CODING_AGENT: 'true', CLAUDE_CODE_SESSION_ID: 'left-over' };
  assert.equal(currentHarness(env).id, 'pi');
});

test('Pi is in the registry, and its agent name is reserved', () => {
  assert.equal(harnessById('pi'), pi);
  assert.ok(agentNames().includes('pi'));
});

// --- the resolvers ----------------------------------------------------------

test('the session key comes from the session manager UUID', () => {
  // Not the session file path: /resume and /tree keep the same file while /fork
  // and /clone write a new one, so the id is the identity.
  const ctx = fakePiContext({ sessionId: 'pi-uuid-9' });
  assert.equal(pi.sessionKey({ sessionManager: ctx.sessionManager, env: {} }), 'pi:pi-uuid-9');
});

test('a subprocess falls back to PI_SESSION_ID, which the bash tool sets', () => {
  assert.equal(pi.sessionKey({ env: { PI_SESSION_ID: 'from-env' } }), 'pi:from-env');
});

test('the session manager wins over the environment', () => {
  const ctx = fakePiContext({ sessionId: 'from-manager' });
  const key = pi.sessionKey({ sessionManager: ctx.sessionManager, env: { PI_SESSION_ID: 'from-env' } });
  assert.equal(key, 'pi:from-manager');
});

test('an ephemeral session has no key, rather than a half-formed one', () => {
  const throwing = { getSessionId() { throw new Error('ephemeral'); } };
  assert.equal(pi.sessionKey({ sessionManager: throwing, env: {} }), '');
  assert.equal(pi.sessionKey({ env: {} }), '');
});

test('a work reference is a Pi slash command', () => {
  assert.equal(pi.workRef('review-spec'), '/skill:review-spec');
  assert.doesNotMatch(pi.workRef('review-spec'), /specforge:/);
});

test('re-entry is whatever the binding passes in, and false by default', () => {
  // Pi has no stop_hook_active. Saying something twice beats a session that
  // settles owing a reply, so the default is false.
  assert.equal(pi.reentered({ reentered: true }), true);
  assert.equal(pi.reentered({}), false);
  assert.equal(pi.reentered(), false);
});

// --- the binding ------------------------------------------------------------

test('it registers for exactly the three events, and no others', () => {
  const p = fakePi();
  register(p, fakePiContext());
  assert.deepEqual(p.registeredFor(), ['session_start', 'before_agent_start', 'agent_settled']);
});

test('a turn-start Notice is returned as a message, not sent', () => {
  // before_agent_start takes a message and puts it in front of the model for
  // this turn; sending would land it a turn late.
  const { key, specId } = owning();
  withBatch(specId);
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  return p.fire('before_agent_start', {}, ctx).then(([out]) => {
    assert.match(out.message.content, /review batch\(es\) submitted/);
    assert.equal(out.message.customType, 'specforge');
    assert.equal(p.sent.length, 0, 'nothing was sent');
    assert.ok(key);
  });
});

test('a settle that must be acted on is sent as a triggering follow-up', async () => {
  // The whole of how Pi refuses a settle: followUp waits for the tool calls to
  // finish, triggerTurn makes an idle agent run again.
  const { specId } = owning();
  withBatch(specId);
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  await p.fire('agent_settled', {}, ctx);
  assert.equal(p.sent.length, 1);
  assert.deepEqual(p.sent[0].options, { deliverAs: 'followUp', triggerTurn: true });
  assert.match(p.sent[0].message.content, /review batch/);
});

test('the text it sends names Pi\'s own skill command', () => {
  const { specId } = owning();
  withBatch(specId);
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  return p.fire('agent_settled', {}, ctx).then(() => {
    assert.match(p.sent[0].message.content, /\/skill:review-spec/);
    assert.doesNotMatch(p.sent[0].message.content, /specforge:review-spec/);
  });
});

test('a settle with nothing to say sends nothing', async () => {
  owning({ alive: true });
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  await p.fire('agent_settled', {}, ctx);
  assert.equal(p.sent.length, 0);
});

test('two consecutive settles produce one Notice, not two (re-entry)', async () => {
  // Pi has no stop_hook_active, so the binding tracks it. Without this the
  // Notice that refused a settle would be re-sent on the settle it caused.
  const { specId } = owning({ alive: false });
  withBatch(specId);
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  await p.fire('agent_settled', {}, ctx);
  await p.fire('agent_settled', {}, ctx);
  assert.equal(p.sent.length, 1, 'the second settle is silent');
});

test('a new turn clears the guard, so the next round can speak again', async () => {
  const { specId } = owning({ alive: false });
  withBatch(specId);
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  await p.fire('agent_settled', {}, ctx);
  await p.fire('before_agent_start', {}, ctx);
  await p.fire('agent_settled', {}, ctx);
  assert.equal(p.sent.length, 2, 'the round reset');
});

test('a session start reports what this session owns', async () => {
  owning();
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'pi-uuid-1' });
  register(p, ctx);
  await p.fire('session_start', {}, ctx);
  assert.equal(p.sent.length, 1);
  assert.match(p.sent[0].message.content, /owns 1 spec/);
  assert.equal(p.sent[0].options.deliverAs, 'nextTurn', 'a start does not interrupt anything');
});

test('a session owning nothing is silent on every event', async () => {
  const p = fakePi();
  const ctx = fakePiContext({ sessionId: 'nobody-at-all' });
  register(p, ctx);
  for (const e of ['session_start', 'before_agent_start', 'agent_settled']) {
    await p.fire(e, {}, ctx);
  }
  assert.equal(p.sent.length, 0);
});

// --- fail-safe (I5) ---------------------------------------------------------

test('a handler that throws leaves the session running and sends nothing', async () => {
  const p = fakePi();
  // A context whose session manager explodes on every read.
  const hostile = { sessionManager: { getSessionId() { throw new Error('boom'); } } };
  register(p, hostile);
  for (const e of ['session_start', 'before_agent_start', 'agent_settled']) {
    await assert.doesNotReject(() => p.fire(e, {}, hostile), e);
  }
  assert.equal(p.sent.length, 0);
});

// --- E1: the size of the diff -----------------------------------------------

test('the adapter imports nothing from Pi', () => {
  // It is read by a subprocess Pi's bash tool started, where Pi's own modules
  // are not loaded.
  const src = readFileSync(join(ROOT, 'lib', 'harness', 'pi.mjs'), 'utf8');
  assert.doesNotMatch(src, /^import .*pi-coding-agent/m);
  assert.doesNotMatch(src, /^import .*['"]pi['"]/m);
});

test('the binding holds no policy: it imports the decision rather than making one', () => {
  const src = readFileSync(join(ROOT, 'extensions', 'specforge.mjs'), 'utf8');
  assert.match(src, /import \{ onEvent \}/);
  for (const word of ['pendingForSession', 'watcherBeating', 'specsForSession']) {
    assert.doesNotMatch(src, new RegExp(word), `the binding reimplements ${word}`);
  }
});

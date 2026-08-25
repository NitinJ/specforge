// The Stage 0 fixtures, asserted by the first tests that use them.
//
// A fixture nobody has exercised is a fixture that is wrong. These are small on
// purpose: what they prove is that a later stage can script a harness, record a
// Pi call, and seed two sessions that do not collide.
//
// Spec e9ddcddef6, tasks 0.1, 0.2 and 0.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { fakeHarness, throwingHarness } from './helpers/fake-harness.mjs';
import { fakePi, fakePiContext } from './helpers/fake-pi.mjs';
import { seedSession, seedLegacySession } from './helpers/live-session.mjs';
import { sessionPath } from '../lib/store-paths.mjs';
import { encodeKey } from '../lib/session-key.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-helpers-');

// --- fake-harness -----------------------------------------------------------

test('a fake harness answers with fixed values or with functions', () => {
  const fixed = fakeHarness({ id: 'pi', agentName: 'pi', sessionKey: 'pi:xyz' });
  assert.equal(fixed.sessionKey(), 'pi:xyz');
  assert.equal(fixed.agentName, 'pi');

  const scripted = fakeHarness({ sessionKey: (ctx) => `pi:${ctx.who}` });
  assert.equal(scripted.sessionKey({ who: 'abc' }), 'pi:abc');
});

test('it renders a work reference and a re-entry flag', () => {
  const h = fakeHarness({ workRef: (id) => `/skill:${id}`, reentered: true });
  assert.equal(h.workRef('review-spec'), '/skill:review-spec');
  assert.equal(h.reentered(), true);
});

test('the throwing variant fails on every resolver (I5 fixture)', () => {
  const h = throwingHarness('deliberate');
  for (const name of ['sessionKey', 'workRef', 'reentered']) {
    assert.throws(() => h[name]({}), /deliberate/, name);
  }
});

// --- fake-pi ----------------------------------------------------------------

test('fake pi records what a binding registered for, in order', () => {
  const pi = fakePi();
  pi.on('session_start', () => {});
  pi.on('agent_settled', () => {});
  assert.deepEqual(pi.registeredFor(), ['session_start', 'agent_settled']);
});

test('firing an event runs its handlers and hands back their returns', async () => {
  const pi = fakePi();
  pi.on('before_agent_start', async () => ({ message: { content: 'hi' } }));
  const [out] = await pi.fire('before_agent_start', {}, fakePiContext());
  assert.equal(out.message.content, 'hi');
});

test('sendMessage records its options, which is what the binding must get right', () => {
  const pi = fakePi();
  pi.sendMessage({ content: 'x' }, { deliverAs: 'followUp', triggerTurn: true });
  assert.equal(pi.sent.length, 1);
  assert.deepEqual(pi.sent[0].options, { deliverAs: 'followUp', triggerTurn: true });
});

test('firing an event nobody registered for is a no-op, not a throw', async () => {
  assert.deepEqual(await fakePi().fire('agent_settled'), []);
});

test('the fake context answers with a session UUID, per Q2', () => {
  const ctx = fakePiContext({ sessionId: 'pi-uuid-9' });
  assert.equal(ctx.sessionManager.getSessionId(), 'pi-uuid-9');
});

// --- live-session -----------------------------------------------------------

test('two harnesses seeded with one raw id are distinct on disk (I1)', () => {
  const a = seedSession({ id: 'shared-id', harness: 'claude' });
  const b = seedSession({ id: 'shared-id', harness: 'pi' });
  assert.notEqual(a.key, b.key);
  assert.ok(existsSync(sessionPath(encodeKey(a.key))));
  assert.ok(existsSync(sessionPath(encodeKey(b.key))));
  assert.notEqual(sessionPath(encodeKey(a.key)), sessionPath(encodeKey(b.key)));
});

test('a seeded session records the harness it belongs to', () => {
  const s = seedSession({ id: 'x', harness: 'pi' });
  const rec = JSON.parse(readFileSync(sessionPath(encodeKey(s.key)), 'utf8'));
  assert.equal(rec.harness, 'pi');
  assert.equal(s.key, 'pi:x');
});

test('seeding defaults to Claude Code, byte-identical to what the store holds', () => {
  // Not merely "close enough": the 111 records on this machine have no harness
  // field and a bare filename, and a fixture that differed would test a shape
  // that does not exist anywhere.
  const s = seedSession({ id: 'x' });
  assert.equal(s.harness, 'claude');
  assert.equal(s.id, 'x', 'the raw id, which is what attach and watcherAlive take');
  assert.equal(s.key, 'claude:x');
  assert.ok(existsSync(sessionPath('x')), 'and lands on the bare filename');
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(sessionPath('x'), 'utf8'))).sort(),
    ['specs', 'watcherPid'],
    'with no harness field',
  );
});

test('a legacy session has no harness field and a bare filename (I2 fixture)', () => {
  const s = seedLegacySession({ id: 'old-1' });
  const rec = JSON.parse(readFileSync(sessionPath('old-1'), 'utf8'));
  assert.equal(rec.harness, undefined);
  assert.equal(s.id, 'old-1');
  assert.equal(s.key, 'claude:old-1');
});

test('a dead session is seeded with a pid that is not running', () => {
  const dead = seedSession({ id: 'd', alive: false });
  assert.notEqual(dead.watcherPid, process.pid);
});

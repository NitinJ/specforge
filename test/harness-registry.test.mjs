// Which harness is running, and what it answers.
//
// Resolution can never throw and can never return null. Every caller's next move
// after "which harness is this" is to read the store, and a failure here would
// wedge a session over a question with a safe default (E4).
//
// Spec e9ddcddef6, task 1.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  currentHarness, currentSessionKey, harnessById, harnessIds, agentNames, harnesses,
  DEFAULT_HARNESS,
} from '../lib/harness/index.mjs';
import { claude, detect as detectClaude } from '../lib/harness/claude.mjs';

// --- the record contract ----------------------------------------------------

test('every harness supplies the same five fields', () => {
  // The contract a third CLI implements. A record missing one of these would
  // fail at whichever call site happened to reach it first.
  for (const h of harnesses()) {
    assert.equal(typeof h.id, 'string', `${h.id} id`);
    assert.equal(typeof h.agentName, 'string', `${h.id} agentName`);
    for (const fn of ['sessionKey', 'workRef', 'reentered']) {
      assert.equal(typeof h[fn], 'function', `${h.id} ${fn}`);
    }
  }
});

test('ids and agent names are unique across harnesses', () => {
  // Two harnesses sharing an id would collide in every session key; two sharing
  // an agent name would make a reply unattributable.
  assert.equal(new Set(harnessIds()).size, harnessIds().length);
  assert.equal(new Set(agentNames()).size, agentNames().length);
});

// --- resolution -------------------------------------------------------------

test('an unrecognised environment resolves to Claude Code, never to null', () => {
  const h = currentHarness({});
  assert.equal(h, DEFAULT_HARNESS);
  assert.equal(h.id, 'claude');
});

test('SPECFORGE_HARNESS wins over every marker', () => {
  assert.equal(currentHarness({ SPECFORGE_HARNESS: 'claude', PI_CODING_AGENT: 'true' }).id, 'claude');
});

test('an unknown SPECFORGE_HARNESS falls through rather than failing', () => {
  // A typo in an env var must not stop a session. It resolves to the default,
  // which is what the environment would have given anyway.
  assert.equal(currentHarness({ SPECFORGE_HARNESS: 'nope' }).id, 'claude');
});

test('harnessById answers null for a name nobody registered', () => {
  assert.equal(harnessById('nope'), null);
  assert.equal(harnessById('claude'), claude);
});

// --- Claude Code detection --------------------------------------------------

test('Claude Code is detected by any of its three markers', () => {
  for (const env of [
    { CLAUDECODE: '1' },
    { CLAUDE_CODE_SESSION_ID: 'abc' },
    { AI_AGENT: 'claude-code_2-1-245_agent' },
  ]) {
    assert.equal(detectClaude(env), true, JSON.stringify(env));
    assert.equal(currentHarness(env).id, 'claude');
  }
});

test('a bare environment is not detected as Claude Code', () => {
  // It still resolves to Claude Code as the fallback. Detection and fallback are
  // separate answers, and conflating them would make the fallback untestable.
  assert.equal(detectClaude({}), false);
});

// --- the Claude Code resolvers ----------------------------------------------

test('the session key is the harness id and the raw id', () => {
  assert.equal(claude.sessionKey({ env: { CLAUDE_CODE_SESSION_ID: 'abc' } }), 'claude:abc');
});

test('the payload session id wins over the environment', () => {
  // A hook env missing the variable would otherwise silently no-op for a session
  // that owns specs, stopping its heartbeats under a live window.
  const key = claude.sessionKey({
    payload: { session_id: 'from-payload' },
    env: { CLAUDE_CODE_SESSION_ID: 'from-env' },
  });
  assert.equal(key, 'claude:from-payload');
});

test('no session anywhere yields an empty key, not a half-formed one', () => {
  // `claude:` would compare unequal to everything and equal to any other
  // half-formed key, which is worse than having no key.
  assert.equal(claude.sessionKey({ env: {} }), '');
  assert.equal(claude.sessionKey({ payload: {}, env: {} }), '');
});

test('called with no argument it reads the real environment', () => {
  // Deliberate: production calls it that way. Asserted rather than assumed,
  // because a default of `{}` would make every hook gate out silently.
  const key = claude.sessionKey();
  const expected = process.env.CLAUDE_CODE_SESSION_ID
    ? `claude:${process.env.CLAUDE_CODE_SESSION_ID}`
    : '';
  assert.equal(key, expected);
});

test('a work reference is the plugin-namespaced skill command', () => {
  assert.equal(claude.workRef('review-spec'), 'specforge:review-spec');
  assert.equal(claude.workRef('generate-template'), 'specforge:generate-template');
});

test('re-entry reads the payload flag that stops a blocking Stop from looping', () => {
  assert.equal(claude.reentered({ payload: { stop_hook_active: true } }), true);
  assert.equal(claude.reentered({ payload: {} }), false);
  assert.equal(claude.reentered(), false);
});

// --- currentSessionKey ------------------------------------------------------

test('currentSessionKey resolves through the harness', () => {
  assert.equal(currentSessionKey({ env: { CLAUDE_CODE_SESSION_ID: 'abc' } }), 'claude:abc');
});

test('a harness whose resolver throws yields an empty key rather than throwing (E4)', () => {
  const boom = { id: 'boom', agentName: 'boom', sessionKey() { throw new Error('x'); } };
  assert.equal(currentSessionKey({ harness: boom }), '');
});

test('no session resolves to an empty string, which owns nothing', () => {
  assert.equal(currentSessionKey({ env: {} }), '');
});

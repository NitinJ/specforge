import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAUDE_HARNESS,
  CODEX_HARNESS,
  PI_HARNESS,
  agentAuthor,
  resolveHarness,
  resolvePluginRoot,
  resolveSessionId,
  sessionIdFromKey,
  sessionKey,
} from '../lib/harness-context.mjs';
import { skillRef } from '../lib/skill-ref.mjs';

test('resolves an explicit harness before native host signals', () => {
  assert.equal(resolveHarness({ PLUGIN_ROOT: '/codex' }, PI_HARNESS), PI_HARNESS);
});

test('resolves Codex from its explicit marker and native variables', () => {
  assert.equal(resolveHarness({ SPECFORGE_HARNESS: CODEX_HARNESS }), CODEX_HARNESS);
  assert.equal(resolveHarness({ CODEX_THREAD_ID: 'thread-1' }), CODEX_HARNESS);
  assert.equal(resolveHarness({ PLUGIN_ROOT: '/installed/specforge' }), CODEX_HARNESS);
});

test('preserves Pi and Claude harness resolution', () => {
  assert.equal(resolveHarness({ SPECFORGE_HARNESS: PI_HARNESS }), PI_HARNESS);
  assert.equal(resolveHarness({ CLAUDE_CODE_SESSION_ID: 'claude-1' }), CLAUDE_HARNESS);
  assert.equal(resolveHarness({}), CLAUDE_HARNESS);
});

test('session precedence is explicit, neutral, Codex, then Claude', () => {
  const env = {
    SPECFORGE_SESSION_ID: 'neutral',
    CODEX_THREAD_ID: 'thread',
    CODEX_SESSION_ID: 'codex',
    CLAUDE_CODE_SESSION_ID: 'claude',
  };
  assert.equal(resolveSessionId(env, 'explicit'), 'explicit');
  assert.equal(resolveSessionId(env), 'neutral');
  delete env.SPECFORGE_SESSION_ID;
  assert.equal(resolveSessionId(env), 'thread');
  delete env.CODEX_THREAD_ID;
  assert.equal(resolveSessionId(env), 'codex');
  delete env.CODEX_SESSION_ID;
  assert.equal(resolveSessionId(env), 'claude');
});

test('plugin root precedence works without shell interpolation', () => {
  const env = { SPECFORGE_PLUGIN_ROOT: '/neutral', PLUGIN_ROOT: '/codex', CLAUDE_PLUGIN_ROOT: '/claude' };
  assert.equal(resolvePluginRoot(env, '/explicit'), '/explicit');
  assert.equal(resolvePluginRoot(env), '/neutral');
  delete env.SPECFORGE_PLUGIN_ROOT;
  assert.equal(resolvePluginRoot(env), '/codex');
});

test('Codex uses the installed plugin namespace and its own reply attribution', () => {
  const env = { SPECFORGE_HARNESS: CODEX_HARNESS };
  assert.equal(skillRef('review-spec', env), 'specforge:review-spec');
  assert.equal(agentAuthor(env), 'codex');
  assert.equal(agentAuthor({ SPECFORGE_HARNESS: PI_HARNESS }), 'pi');
  assert.equal(agentAuthor({ CLAUDE_CODE_SESSION_ID: 'c' }), 'claude');
});

test('unsafe native session ids use a reversible safe filename key', () => {
  const id = '../thread/with spaces';
  const key = sessionKey(id);
  assert.match(key, /^encoded~[A-Za-z0-9_-]+$/);
  assert.equal(sessionIdFromKey(key), id);
  assert.equal(sessionKey('legacy-safe_1'), 'legacy-safe_1');
  assert.equal(sessionIdFromKey('encoded-raw-safe'), 'encoded-raw-safe');
});

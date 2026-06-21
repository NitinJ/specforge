// Unit tests for the friendly session label (lib/session-label.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { promptSnippet, sessionDisplay } from '../lib/session-label.mjs';

test('promptSnippet collapses whitespace and trims', () => {
  assert.equal(promptSnippet('  improve   the\n home  page '), 'improve the home page');
});

test('promptSnippet truncates with an ellipsis past the max', () => {
  const out = promptSnippet('x'.repeat(80), 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith('…'));
});

test('promptSnippet returns "" for non-strings / blank', () => {
  assert.equal(promptSnippet(null), '');
  assert.equal(promptSnippet('   '), '');
});

test('sessionDisplay is null for a free spec', () => {
  assert.equal(sessionDisplay({ attachedSession: null }), null);
});

test('sessionDisplay joins folder and first prompt', () => {
  assert.equal(
    sessionDisplay({ attachedSession: 's', sessionCwd: 'workspace', sessionPrompt: 'improve the home page' }),
    'workspace · "improve the home page"',
  );
});

test('sessionDisplay shows folder alone when no prompt captured', () => {
  assert.equal(sessionDisplay({ attachedSession: 's', sessionCwd: 'workspace' }), 'workspace');
});

test('sessionDisplay falls back to the short id when neither part exists', () => {
  assert.equal(sessionDisplay({ attachedSession: 'abcdef1234567890' }), 'session abcdef12');
});

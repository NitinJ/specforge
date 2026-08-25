// Unit tests for the session display label (lib/session-label.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sessionDisplay } from '../lib/session-label.mjs';

test('sessionDisplay is null for a free spec', () => {
  assert.equal(sessionDisplay({ attachedSession: null }), null);
  assert.equal(sessionDisplay({}), null);
});

test('sessionDisplay shows the harness and a short session id when attached', () => {
  // The harness is kept whole and the raw id is shortened. Cutting the whole key
  // at 8 characters gave `claude:s`, which names neither.
  assert.equal(sessionDisplay({ attachedSession: 'claude:abcdef1234567890' }), 'session claude:abcdef12');
});

test('an unprefixed session still labels as Claude Code', () => {
  // Every spec attached before harnesses existed holds a bare id.
  assert.equal(sessionDisplay({ attachedSession: 'abcdef1234567890' }), 'session claude:abcdef12');
});

test('a Pi session is labelled as Pi, which is the point of keeping the harness', () => {
  assert.equal(sessionDisplay({ attachedSession: 'pi:01J8ZQRS' }), 'session pi:01J8ZQRS');
});

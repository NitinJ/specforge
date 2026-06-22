// Unit tests for the session display label (lib/session-label.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sessionDisplay } from '../lib/session-label.mjs';

test('sessionDisplay is null for a free spec', () => {
  assert.equal(sessionDisplay({ attachedSession: null }), null);
  assert.equal(sessionDisplay({}), null);
});

test('sessionDisplay shows the short session id when attached', () => {
  assert.equal(sessionDisplay({ attachedSession: 'abcdef1234567890' }), 'session abcdef12');
});

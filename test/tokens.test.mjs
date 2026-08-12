// Publication tokens: the only thing between the public internet and a spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newToken, isToken, TOKEN_BYTES, TOKEN_LENGTH } from '../lib/tokens.mjs';

test('a token is hex of the declared length', () => {
  const t = newToken();
  assert.equal(t.length, TOKEN_LENGTH);
  assert.equal(TOKEN_LENGTH, TOKEN_BYTES * 2);
  assert.match(t, /^[0-9a-f]+$/);
});

// The token is the whole secret once the hostname is shared, so a collision or
// a predictable value exposes one spec to the holder of another's link.
test('tokens do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(newToken());
  assert.equal(seen.size, 2000);
});

test('a token carries at least 128 bits', () => {
  assert.ok(TOKEN_BYTES >= 16, `${TOKEN_BYTES} bytes is under the 16 the design requires`);
});

test('isToken accepts what newToken makes', () => {
  assert.equal(isToken(newToken()), true);
});

// A spec id is 10 hex characters and appears in owner-facing URLs and CLI
// arguments. If it validated as a token, the public origin would resolve it and
// every spec id ever pasted anywhere would be a working public address.
test('isToken rejects a spec id', () => {
  assert.equal(isToken('0c0a9bcb4a'), false);
});

test('isToken rejects the shapes an attacker would try', () => {
  for (const bad of [
    '', null, undefined, 42, {}, [],
    'z'.repeat(TOKEN_LENGTH), // right length, wrong alphabet
    'A'.repeat(TOKEN_LENGTH), // uppercase hex is not what we mint
    `${'a'.repeat(TOKEN_LENGTH)}b`, // one too long
    'a'.repeat(TOKEN_LENGTH - 1), // one too short
    `../../${'a'.repeat(TOKEN_LENGTH - 6)}`, // traversal
    `${'a'.repeat(TOKEN_LENGTH)}\n`, // trailing newline
  ]) {
    assert.equal(isToken(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

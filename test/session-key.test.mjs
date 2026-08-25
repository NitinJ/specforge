// Session keys, and the one rule that decides whether an upgrade is silent or
// catastrophic: a key with no harness in it is Claude Code's.
//
// Every session record in the store today is that shape. A reader that treats an
// unprefixed key as belonging to nobody detaches all 111 specs at once and says
// nothing (I2).
//
// Spec e9ddcddef6, tasks 0.1 and 1.3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessionKey, parseKey, harnessOf, normalizeKey, sameSession,
  encodeKey, decodeKey, LEGACY_HARNESS,
} from '../lib/session-key.mjs';

// --- composing and splitting ------------------------------------------------

test('a key is the harness and the raw id, joined by a colon', () => {
  assert.equal(sessionKey('claude', 'abc-123'), 'claude:abc-123');
  assert.equal(sessionKey('pi', '01J8Z'), 'pi:01J8Z');
});

test('a key with a missing part is empty rather than half-formed', () => {
  // `claude:` and `:abc` would both compare unequal to everything and equal to
  // each other, which is worse than having no key at all.
  assert.equal(sessionKey('claude', ''), '');
  assert.equal(sessionKey('', 'abc'), '');
  assert.equal(sessionKey(undefined, undefined), '');
});

test('parsing splits on the first colon, so a raw id may contain one', () => {
  assert.deepEqual(parseKey('pi:a:b:c'), { harness: 'pi', raw: 'a:b:c' });
});

test('an unprefixed key parses as Claude Code (I2)', () => {
  assert.deepEqual(parseKey('703b4fc4-83f0'), { harness: 'claude', raw: '703b4fc4-83f0' });
  assert.equal(harnessOf('703b4fc4-83f0'), LEGACY_HARNESS);
});

// --- comparing --------------------------------------------------------------

test('the prefixed and unprefixed forms name the same session', () => {
  // The whole migration is this assertion. meta.attachedSession holds the bare
  // form on every existing spec, and the running session reports the prefixed
  // one.
  assert.ok(sameSession('abc-123', 'claude:abc-123'));
  assert.ok(sameSession('claude:abc-123', 'abc-123'));
  assert.equal(normalizeKey('abc-123'), 'claude:abc-123');
});

test('two harnesses issuing one raw id are different sessions (I1)', () => {
  assert.equal(sameSession('claude:abc-123', 'pi:abc-123'), false);
});

test('an empty key matches nothing, including another empty key', () => {
  // A spec with no attachedSession must not read as owned by a session with no
  // id, which is what a plain string comparison would do.
  assert.equal(sameSession('', ''), false);
  assert.equal(sameSession('', 'claude:abc'), false);
  assert.equal(sameSession(undefined, null), false);
});

// --- the filename encoding (I12) --------------------------------------------

test('no encoded filename contains a character a filesystem reserves', () => {
  // The colon is legal on Linux and macOS and reserved on Windows, where NTFS
  // reads it as an alternate data stream separator. The slash is worse: it would
  // put the record in a subdirectory, or outside the store.
  //
  // An earlier version of this test stripped slashes before asserting, which
  // made it agree with the bug it was meant to catch. Raised in review of #231.
  const reserved = /[:<>"|?*\\/]/;
  for (const key of ['claude:abc-123', 'pi:01J8Z', 'codex:x/y', 'gemini:a', 'pi:a b', 'claude:x:y']) {
    const name = encodeKey(key);
    assert.doesNotMatch(name, reserved, `${key} encodes to ${name}`);
  }
});

test('a session id cannot escape the sessions directory', () => {
  // `--session` takes whatever it is given, and the store path is derived from
  // it. Traversal here would write a JSON file anywhere the process can reach.
  for (const key of ['claude:../../etc/passwd', 'pi:../../../x', 'claude:/abs/path']) {
    const name = encodeKey(key);
    assert.doesNotMatch(name, /[/\\]/, `${key} encodes to ${name}`);
    assert.equal(name.startsWith('..') && !name.includes('%'), false, name);
  }
});

test('a name that would address the directory itself is refused', () => {
  assert.equal(encodeKey('claude:.'), '');
  assert.equal(encodeKey('claude:..'), '');
});

test('an id carrying the delimiter round-trips, and does not forge a harness', () => {
  // `claude:a__b` used to encode to `a__b` and decode to harness `a`, raw `b`.
  // Escaping the underscore leaves `__` able to mean only the delimiter.
  assert.equal(decodeKey(encodeKey('claude:a__b')), 'claude:a__b');
  assert.equal(decodeKey(encodeKey('pi:a__b')), 'pi:a__b');
  assert.doesNotMatch(encodeKey('claude:a__b'), /__/);
});

test('ids carrying odd characters round-trip exactly', () => {
  for (const raw of ['a b', 'x/y', 'p%20q', 'a:b', 'ünïcode', '..', '_', '%']) {
    for (const harness of ['claude', 'pi']) {
      const key = `${harness}:${raw}`;
      const name = encodeKey(key);
      if (!name) continue; // refused as unsafe, asserted above
      assert.equal(decodeKey(name), key, `${key} via ${name}`);
    }
  }
});

test('a Claude Code key keeps its bare filename, so nothing on disk moves', () => {
  // 111 session records are named this way. Renaming them would be a migration,
  // and E3 says there is not one.
  assert.equal(encodeKey('claude:abc-123'), 'abc-123');
  assert.equal(encodeKey('abc-123'), 'abc-123');
});

test('another harness encodes its prefix into the name', () => {
  assert.equal(encodeKey('pi:01J8Z'), 'pi__01J8Z');
});

test('decoding is the inverse of encoding for every key', () => {
  for (const key of ['claude:abc-123', 'pi:01J8Z', 'codex:zz', 'gemini:q-1']) {
    assert.equal(decodeKey(encodeKey(key)), key, key);
  }
});

test('an existing bare filename decodes to a Claude Code key', () => {
  assert.equal(decodeKey('703b4fc4-83f0'), 'claude:703b4fc4-83f0');
});

test('encoding an empty key yields an empty name rather than a stray separator', () => {
  assert.equal(encodeKey(''), '');
  assert.equal(decodeKey(''), '');
});

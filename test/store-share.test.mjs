// The share record: what publication state survives on disk.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-share-'));
process.env.SPECFORGE_HOME = home;

const { readShare, writeShare, clearShare, isLegacyShare } = await import('../lib/store-share.mjs');
const { specDir, sharePath } = await import('../lib/store-paths.mjs');
const { newToken } = await import('../lib/tokens.mjs');

after(() => rmSync(home, { recursive: true, force: true }));

const seed = (id) => mkdirSync(specDir(id), { recursive: true });
const writeRaw = (id, obj) => { seed(id); writeFileSync(sharePath(id), JSON.stringify(obj)); };

test('a record round-trips', () => {
  seed('alpha');
  const rec = { specId: 'alpha', token: newToken(), createdAt: 'now' };
  writeShare('alpha', rec);
  assert.deepEqual(readShare('alpha'), rec);
});

test('an unpublished spec has no record', () => {
  seed('beta');
  assert.equal(readShare('beta'), null);
});

test('clearShare reports whether there was anything to remove', () => {
  seed('gamma');
  writeShare('gamma', { specId: 'gamma', token: newToken(), createdAt: 'now' });
  assert.equal(clearShare('gamma'), true);
  assert.equal(clearShare('gamma'), false);
  assert.equal(readShare('gamma'), null);
});

// The old scheme recorded a per-spec url, port and pid. The port is gone after
// the daemon that owned it exits, and the design no longer creates a tunnel per
// spec, so such a record cannot be honoured — only reaped.
test('a record without a token is not readable as a publication', () => {
  writeRaw('delta', { specId: 'delta', url: 'https://old.example', port: 5, pid: 77, createdAt: 'then' });
  assert.equal(readShare('delta'), null, 'it does not read as published');
});

test('isLegacyShare finds the old record and the pid to reap', () => {
  writeRaw('epsilon', { specId: 'epsilon', url: 'https://old.example', port: 5, pid: 77, createdAt: 'then' });
  const legacy = isLegacyShare('epsilon');
  assert.deepEqual(legacy, { pid: 77 });
});

test('isLegacyShare tolerates an old record that named no pid', () => {
  writeRaw('zeta', { specId: 'zeta', url: 'https://old.example', port: 5, createdAt: 'then' });
  assert.deepEqual(isLegacyShare('zeta'), { pid: null });
});

test('isLegacyShare says nothing about a current record', () => {
  seed('eta');
  writeShare('eta', { specId: 'eta', token: newToken(), createdAt: 'now' });
  assert.equal(isLegacyShare('eta'), null);
});

test('isLegacyShare says nothing about an unpublished spec', () => {
  seed('theta');
  assert.equal(isLegacyShare('theta'), null);
});

test('a malformed token is not readable as a publication', () => {
  writeRaw('iota', { specId: 'iota', token: 'not-a-token', createdAt: 'now' });
  assert.equal(readShare('iota'), null);
});

test('unreadable JSON is not a publication and is not legacy', () => {
  seed('kappa');
  writeFileSync(sharePath('kappa'), '{ not json');
  assert.equal(readShare('kappa'), null);
  assert.equal(isLegacyShare('kappa'), null);
});

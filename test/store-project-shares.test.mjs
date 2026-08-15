// Project-share records, at <STORE_ROOT>/project-shares.json.
//
// The lifecycle mirrors a spec's share.json: the token outlives an unshare so a
// re-share hands back the URL people already have, and rotating is the only
// thing that changes it. What differs is the address: a project is a name on
// spec meta rather than a directory, so every record lives in one file.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pshares-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const mod = await import('../lib/store-project-shares.mjs');
const { newToken } = await import('../lib/tokens.mjs');
const { projectSharesPath } = await import('../lib/store-paths.mjs');

test('a written record reads back, and an unknown project reads as null', () => {
  const token = newToken();
  mod.writeProjectShare('specforge', { token, createdAt: '2026-08-15T00:00:00Z' });
  const rec = mod.readProjectShare('specforge');
  assert.equal(rec.token, token);
  assert.equal(mod.readProjectShare('never-shared'), null);
});

test('unsharing keeps the token, and readProjectShareToken still returns it', () => {
  const token = newToken();
  mod.writeProjectShare('specforge', { token, createdAt: '2026-08-15T00:00:00Z' });
  const was = mod.clearProjectShare('specforge');
  assert.equal(was, true);
  // The publication is gone but the token is not: a re-share must return the
  // URL that is already in someone's chat history.
  assert.equal(mod.readProjectShare('specforge'), null);
  assert.equal(mod.readProjectShareToken('specforge'), token);
});

test('clearing a project that was never shared reports false', () => {
  assert.equal(mod.clearProjectShare('nothing-here'), false);
});

test('project names are normalized, so lookups survive stray whitespace', () => {
  const token = newToken();
  mod.writeProjectShare('  Figur   design studio ', { token, createdAt: 'x' });
  assert.equal(mod.readProjectShare('Figur design studio').token, token);
  assert.equal(mod.normalizeProjectName('  a   b '), 'a b');
});

test('a corrupt file reads as no records rather than throwing', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(projectSharesPath(), '{not json');
  assert.equal(mod.readProjectShare('specforge'), null);
  assert.deepEqual(mod.listProjectShares(), []);
});

test('a record whose token is not token-shaped is ignored', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(projectSharesPath(), JSON.stringify({
    evil: { token: '../../etc/passwd', createdAt: 'x' },
  }));
  assert.equal(mod.readProjectShare('evil'), null);
  assert.equal(mod.readProjectShareToken('evil'), null);
});

test('listProjectShares returns only currently-published records', () => {
  const a = newToken();
  const b = newToken();
  mod.writeProjectShare('alpha', { token: a, createdAt: 'x' });
  mod.writeProjectShare('beta', { token: b, createdAt: 'x' });
  mod.clearProjectShare('beta');
  const names = mod.listProjectShares().map((r) => r.project);
  assert.deepEqual(names, ['alpha']);
});

// Contributions: other people's specs listed in a project you created.
//
// An entry is {origin, token, title, owner} and never content. The spec it
// names stays on its contributor's machine, published under their own spec
// token, so the creator's store gains a metadata row and nothing else (spec
// 82f5dabccf, R4 / D9).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-contrib-'));
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

const TOK = 'a'.repeat(32);

function share(project = 'atelier') {
  mod.writeProjectShare(project, { token: TOK, createdAt: '2026-08-15T00:00:00Z' });
  return project;
}

test('an entry is added to a shared project and reads back', () => {
  const p = share();
  const t = newToken();
  const entry = mod.addContribution(p, {
    origin: 'https://theirs.example', token: t, title: 'Their spec', owner: 'mira',
  });
  assert.equal(entry.origin, 'https://theirs.example');
  assert.equal(entry.token, t);
  assert.equal(entry.title, 'Their spec');
  assert.equal(entry.owner, 'mira');
  assert.ok(entry.addedAt);
  assert.deepEqual(mod.listContributions(p).map((e) => e.token), [t]);
});

test('contributing to a project that is not shared is refused', () => {
  assert.throws(() => mod.addContribution('never-shared', {
    origin: 'https://theirs.example', token: newToken(), title: 'x', owner: 'y',
  }), /not a shared project/);
});

test('re-contributing the same spec updates its row instead of duplicating it', () => {
  const p = share();
  const t = newToken();
  mod.addContribution(p, { origin: 'https://theirs.example', token: t, title: 'Draft title', owner: 'mira' });
  mod.addContribution(p, { origin: 'https://theirs.example', token: t, title: 'Renamed', owner: 'mira' });
  const rows = mod.listContributions(p);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Renamed');
});

test('an entry carries no spec content, only the four fields', () => {
  const p = share();
  mod.addContribution(p, {
    origin: 'https://theirs.example', token: newToken(), title: 'x', owner: 'y',
    html: '<h1>should not travel</h1>', body: 'nor this',
  });
  const [row] = mod.listContributions(p);
  assert.deepEqual(Object.keys(row).sort(), ['addedAt', 'origin', 'owner', 'title', 'token']);
  const raw = JSON.stringify(mod.listContributions(p));
  assert.doesNotMatch(raw, /should not travel/);
});

test('a malformed origin or token is refused', () => {
  const p = share();
  for (const bad of [
    { origin: 'javascript:alert(1)', token: newToken() },
    { origin: 'https://theirs.example', token: 'not-a-token' },
    { origin: 'https://theirs.example/p/abc', token: newToken() },
  ]) {
    assert.throws(() => mod.addContribution(p, { ...bad, title: 'x', owner: 'y' }),
      /origin or token/);
  }
  assert.deepEqual(mod.listContributions(p), []);
});

test('title and owner are length-capped and whitespace-collapsed', () => {
  const p = share();
  mod.addContribution(p, {
    origin: 'https://theirs.example',
    token: newToken(),
    title: `  a${' b'.repeat(200)} `,
    owner: '  mira   k  ',
  });
  const [row] = mod.listContributions(p);
  assert.ok(row.title.length <= 120);
  assert.equal(row.owner, 'mira k');
  assert.doesNotMatch(row.title, /\s\s/);
});

test('a contributor withdraws with the spec token they registered', () => {
  const p = share();
  const mine = newToken();
  const theirs = newToken();
  mod.addContribution(p, { origin: 'https://a.example', token: mine, title: 'Mine', owner: 'me' });
  mod.addContribution(p, { origin: 'https://b.example', token: theirs, title: 'Theirs', owner: 'them' });
  assert.equal(mod.removeContribution(p, mine), true);
  assert.deepEqual(mod.listContributions(p).map((e) => e.title), ['Theirs']);
  assert.equal(mod.removeContribution(p, mine), false, 'already gone');
});

test('the entry list is capped, so a token holder cannot fill the file', () => {
  const p = share();
  for (let i = 0; i < mod.MAX_CONTRIBUTIONS; i += 1) {
    mod.addContribution(p, {
      origin: `https://n${i}.example`, token: newToken(), title: `s${i}`, owner: 'o',
    });
  }
  assert.throws(() => mod.addContribution(p, {
    origin: 'https://over.example', token: newToken(), title: 'over', owner: 'o',
  }), /limit/);
  assert.equal(mod.listContributions(p).length, mod.MAX_CONTRIBUTIONS);
});

test('unsharing keeps the entries, so a re-share brings the project back whole', () => {
  const p = share();
  const t = newToken();
  mod.addContribution(p, { origin: 'https://theirs.example', token: t, title: 'x', owner: 'y' });
  mod.clearProjectShare(p);
  assert.equal(mod.readProjectShare(p), null);
  mod.writeProjectShare(p, { token: TOK, createdAt: 'x' });
  assert.deepEqual(mod.listContributions(p).map((e) => e.token), [t]);
});

test('entries in a corrupt file read as none rather than throwing', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(projectSharesPath(), '{not json');
  assert.deepEqual(mod.listContributions('atelier'), []);
});

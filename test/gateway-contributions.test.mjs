// The gateway's contribution surface: how a remote teammate lists their spec
// in a project someone else created, and how that spec appears on the page.
//
// The write this adds is the first on the public socket that is not a comment.
// It writes a metadata row on the project-share record and nothing else — never
// a spec, never another machine's HTML — which is the property most of these
// tests are about.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-gw-contrib-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { createGatewayServer } = await import('../lib/gateway.mjs');
const { specDir, specHtmlPath } = await import('../lib/store-paths.mjs');
const { newToken } = await import('../lib/tokens.mjs');
const {
  writeProjectShare, listContributions, addContribution,
} = await import('../lib/store-project-shares.mjs');

const PTOK = newToken();

function seedSpec(id, project) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${id}</title></head><body><p>${id}</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({
    id, title: id, status: 'draft', project, updated: Date.now(),
  }));
}

async function serve(t) {
  writeProjectShare('atelier', { token: PTOK, createdAt: '2026-08-15T00:00:00Z' });
  const server = createGatewayServer(() => null, (tk) => (tk === PTOK ? 'atelier' : null));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

const entry = (over = {}) => ({
  origin: 'https://theirs.example',
  token: newToken(),
  title: 'Their spec',
  owner: 'mira',
  ...over,
});

test('a contributor registers a pointer and it appears on the project page', async (t) => {
  const base = await serve(t);
  const body = entry();
  const r = await fetch(`${base}/p/${PTOK}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 201);

  const rows = listContributions('atelier');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, body.token);

  const page = await (await fetch(`${base}/p/${PTOK}`)).text();
  assert.match(page, /Their spec/);
  assert.match(page, /mira/, 'the contributor is named on their row');
  assert.ok(page.includes(`https://theirs.example/s/${body.token}`),
    'the row links to the contributor’s own origin, not to this one');
});

test('the write lands on the share record and touches no spec', async (t) => {
  const base = await serve(t);
  seedSpec('local1', 'atelier');
  const before = statSync(specHtmlPath('local1')).mtimeMs;
  await fetch(`${base}/p/${PTOK}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry()),
  });
  assert.equal(statSync(specHtmlPath('local1')).mtimeMs, before);
});

test('spec content in the body is dropped rather than stored', async (t) => {
  const base = await serve(t);
  await fetch(`${base}/p/${PTOK}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry({ html: '<script>alert(1)</script>', body: 'nope' })),
  });
  const raw = JSON.stringify(listContributions('atelier'));
  assert.doesNotMatch(raw, /alert\(1\)/);
  assert.doesNotMatch(raw, /nope/);
});

test('a contributed title is escaped into the page', async (t) => {
  const base = await serve(t);
  await fetch(`${base}/p/${PTOK}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry({ title: '<img src=x onerror=alert(1)>' })),
  });
  const page = await (await fetch(`${base}/p/${PTOK}`)).text();
  assert.doesNotMatch(page, /<img src=x/);
  assert.match(page, /&lt;img src=x/);
});

test('a malformed entry is refused, and nothing is recorded', async (t) => {
  const base = await serve(t);
  for (const bad of [
    entry({ origin: 'javascript:alert(1)' }),
    entry({ token: 'not-a-token' }),
    entry({ origin: 'https://theirs.example/p/abc' }),
  ]) {
    const r = await fetch(`${base}/p/${PTOK}/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bad),
    });
    assert.equal(r.status, 400);
  }
  assert.deepEqual(listContributions('atelier'), []);
});

test('an unknown project token cannot register anything', async (t) => {
  const base = await serve(t);
  const r = await fetch(`${base}/p/${newToken()}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry()),
  });
  assert.equal(r.status, 404);
  assert.deepEqual(listContributions('atelier'), []);
});

test('a contributor withdraws with the token they registered', async (t) => {
  const base = await serve(t);
  const mine = newToken();
  addContribution('atelier', entry({ token: mine }));
  addContribution('atelier', entry({ token: newToken(), title: 'Someone else' }));

  const r = await fetch(`${base}/p/${PTOK}/contribute/${mine}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).removed, true);
  assert.deepEqual(listContributions('atelier').map((e) => e.title), ['Someone else']);
});

test('withdrawing something that is not listed reports it rather than 500ing', async (t) => {
  const base = await serve(t);
  const r = await fetch(`${base}/p/${PTOK}/contribute/${newToken()}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).removed, false);
});

test('a malformed spec token on the withdraw path is a 404, not a lookup', async (t) => {
  const base = await serve(t);
  const r = await fetch(`${base}/p/${PTOK}/contribute/not-a-token`, { method: 'DELETE' });
  assert.equal(r.status, 404);
});

test('methods the contribute routes do not offer are refused', async (t) => {
  const base = await serve(t);
  assert.equal((await fetch(`${base}/p/${PTOK}/contribute`)).status, 405);
  assert.equal((await fetch(`${base}/p/${PTOK}/contribute/${newToken()}`, { method: 'POST' })).status, 405);
});

test('a body that is not JSON is a 400, not a crash', async (t) => {
  const base = await serve(t);
  const r = await fetch(`${base}/p/${PTOK}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json at all',
  });
  assert.equal(r.status, 400);
});

test('local and contributed rows appear together, with the local ones unchanged', async (t) => {
  const base = await serve(t);
  seedSpec('local1', 'atelier');
  addContribution('atelier', entry({ title: 'From another machine' }));
  const page = await (await fetch(`${base}/p/${PTOK}`)).text();
  assert.match(page, /local1/);
  assert.match(page, /From another machine/);
  assert.ok(page.includes(`/p/${PTOK}/spec/local1`), 'a local row stays token-scoped here');
});

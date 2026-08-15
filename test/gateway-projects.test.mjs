// The gateway's project surface: one token addressing a whole project.
//
// The properties that matter mirror the spec-token ones (default deny, 404
// parity, nothing owner-owned on the socket) plus the one that is new: the
// listing is evaluated per request from spec meta, so the page always shows the
// project as it is now, and moving a spec out of the project is its revocation.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-gw-proj-'));
process.env.SPECFORGE_HOME = home;

const { createGatewayServer } = await import('../lib/gateway.mjs');
const { specDir, specHtmlPath } = await import('../lib/store-paths.mjs');
const { newToken } = await import('../lib/tokens.mjs');
const { readMeta, writeMeta } = await import('../lib/meta.mjs');

function seed(id, { project = null, status = 'draft', title = id } = {}) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${title}</title></head><body><p id="body">${id} content</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({
    id, title, status, project, updated: Date.now(),
  }));
}

const publishedSpecs = new Map();    // token -> specId
const publishedProjects = new Map(); // token -> project name
const resolveSpec = (t) => publishedSpecs.get(t) || null;
const resolveProject = (t) => publishedProjects.get(t) || null;

let server;
let base;

before(async () => {
  seed('in1', { project: 'atelier', title: 'Widget themes', status: 'draft' });
  seed('in2', { project: 'atelier', title: 'Pricing designer', status: 'approved' });
  seed('out1', { project: 'other', title: 'Out of scope' });
  seed('nop', { project: null, title: 'Unfiled' });
  server = createGatewayServer(resolveSpec, resolveProject);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(home, { recursive: true, force: true });
});

const tok = newToken();

test('a published project token serves an index of exactly its specs', async () => {
  publishedProjects.set(tok, 'atelier');
  const r = await fetch(`${base}/p/${tok}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Widget themes/);
  assert.match(html, /Pricing designer/);
  assert.doesNotMatch(html, /Out of scope/);
  assert.doesNotMatch(html, /Unfiled/);
});

test('every status is listed: a draft is as visible as an approved spec', async () => {
  const html = await (await fetch(`${base}/p/${tok}`)).text();
  assert.match(html, /draft/);
  assert.match(html, /approved/);
});

test('membership is per request: a spec filed later appears on refresh', async () => {
  seed('late', { project: 'atelier', title: 'Filed after the share' });
  const html = await (await fetch(`${base}/p/${tok}`)).text();
  assert.match(html, /Filed after the share/);

  // And moving it out is the revocation: no unshare step exists or is needed.
  const meta = readMeta('late');
  meta.project = 'elsewhere';
  writeMeta('late', meta);
  const after1 = await (await fetch(`${base}/p/${tok}`)).text();
  assert.doesNotMatch(after1, /Filed after the share/);
});

test('a member spec is served with the review layer, told to poll under the project api base', async () => {
  const r = await fetch(`${base}/p/${tok}/spec/in1`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /in1 content/);
  assert.match(html, /"transport":\s*"poll"/);
  assert.ok(html.includes(`/p/${tok}/spec/in1/api`), 'the api base carries the project token');
});

test('a spec outside the project 404s exactly like an unknown token', async () => {
  const outside = await fetch(`${base}/p/${tok}/spec/out1`);
  const unknown = await fetch(`${base}/p/${newToken()}/spec/out1`);
  assert.equal(outside.status, 404);
  assert.equal(outside.status, unknown.status);
  assert.equal(await outside.text(), await unknown.text());
});

test('moving a spec out of the project kills its project-scoped page', async () => {
  seed('mv', { project: 'atelier', title: 'About to move' });
  assert.equal((await fetch(`${base}/p/${tok}/spec/mv`)).status, 200);
  const meta = readMeta('mv');
  meta.project = 'elsewhere';
  writeMeta('mv', meta);
  assert.equal((await fetch(`${base}/p/${tok}/spec/mv`)).status, 404);
});

test('the comments API works under the project token and writes to that spec', async () => {
  const create = await fetch(`${base}/p/${tok}/spec/in2/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: 'a reviewer note',
      author: 'mira',
      anchor: { block: { index: 1, tag: 'P', text: 'in2 content' } },
    }),
  });
  assert.equal(create.status, 201);
  const list = await (await fetch(`${base}/p/${tok}/spec/in2/api/comments`)).json();
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].comments[0].author, 'mira');
});

test('the state and meta polls answer under the project token', async () => {
  const state = await (await fetch(`${base}/p/${tok}/spec/in1/api/state`)).json();
  assert.ok(state.spec > 0);
  const meta = await (await fetch(`${base}/p/${tok}/spec/in1/api/meta`)).json();
  assert.equal(meta.title, 'Widget themes');
  assert.ok(!('attachedSession' in meta), "the owner half stays the owner's");
});

test('the project meta route reports what a subscription card needs', async () => {
  const r = await fetch(`${base}/p/${tok}/api/meta`);
  assert.equal(r.status, 200);
  const meta = await r.json();
  assert.equal(meta.project, 'atelier');
  assert.equal(typeof meta.specs, 'number');
  assert.ok(meta.specs >= 2);
});

test('CORS is on the project meta route and nowhere else (D8)', async () => {
  const meta = await fetch(`${base}/p/${tok}/api/meta`);
  assert.equal(meta.headers.get('access-control-allow-origin'), '*',
    'the Shared-with-me rail fetches this cross-origin');
  for (const path of [
    `/p/${tok}`,
    `/p/${tok}/spec/in1`,
    `/p/${tok}/spec/in1/api/comments`,
    `/p/${tok}/spec/in1/api/meta`,
  ]) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.headers.get('access-control-allow-origin'), null,
      `${path} must stay same-origin`);
  }
});

test('an unknown or unpublished project token is 404, indistinguishably', async () => {
  const revoked = newToken();
  publishedProjects.set(revoked, 'atelier');
  assert.equal((await fetch(`${base}/p/${revoked}`)).status, 200);
  publishedProjects.delete(revoked);
  const gone = await fetch(`${base}/p/${revoked}`);
  const never = await fetch(`${base}/p/${newToken()}`);
  assert.equal(gone.status, never.status);
  assert.equal(await gone.text(), await never.text());
});

test('a project name is not an address, and neither is a spec id under /p/', async () => {
  assert.equal((await fetch(`${base}/p/atelier`)).status, 404);
  assert.equal((await fetch(`${base}/p/${tok}/spec/../../api/prefs`)).status, 404);
});

test('methods the project surface does not offer are refused', async () => {
  assert.equal((await fetch(`${base}/p/${tok}`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/p/${tok}/api/meta`, { method: 'POST' })).status, 405);
});

// The registry builds the real gateway; without this wiring a project token
// resolves in tests that construct the server by hand and nowhere else.
test('a project shared through the publications registry serves on the real gateway', async () => {
  const { createPublications } = await import('../lib/publications.mjs');
  const pubs = createPublications({
    publishImpl: async (port) => ({ url: `https://fake-${port}.example`, pid: 1, stop: async () => {} }),
    killImpl: () => {}, aliveImpl: () => true, ownsImpl: () => true,
    probeImpl: async () => true, sleepImpl: async () => {}, port: 0,
  });
  try {
    const share = await pubs.shareProject('atelier');
    const r = await fetch(`http://127.0.0.1:${pubs.localPort()}/p/${share.token}`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Widget themes/);
  } finally {
    await pubs.stopAll();
  }
});

test('the owner routes are still not on this socket', async () => {
  for (const path of ['/', '/api/shares', `/p/${tok}/api/shares`, `/p/${tok}/spec/in1/api/organize`]) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, 404, `${path} answered ${r.status}`);
  }
});

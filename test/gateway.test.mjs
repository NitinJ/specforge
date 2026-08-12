// The public gateway: one socket, many specs, addressed only by token.
//
// This is the only SpecForge surface reachable from the internet, so the tests
// that matter most are the ones asserting what it refuses.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-gw-'));
process.env.SPECFORGE_HOME = home;

const { createGatewayServer } = await import('../lib/gateway.mjs');
const { specDir, specHtmlPath } = await import('../lib/store-paths.mjs');
const { newToken } = await import('../lib/tokens.mjs');

function seed(id) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${id}</title></head><body><p id="body">${id} content</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: id, status: 'draft' }));
}

const published = new Map();          // token -> specId
const resolve = (t) => published.get(t) || null;

let server;
let base;

before(async () => {
  seed('alpha');
  seed('beta');
  server = createGatewayServer(resolve);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(home, { recursive: true, force: true });
});

const tokAlpha = newToken();
const tokBeta = newToken();

test('a published token serves its spec', async () => {
  published.set(tokAlpha, 'alpha');
  const r = await fetch(`${base}/s/${tokAlpha}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /alpha content/);
});

test('the served page is told to poll, and where its API lives', async () => {
  const html = await (await fetch(`${base}/s/${tokAlpha}`)).text();
  assert.match(html, /"transport":\s*"poll"/, 'SSE does not survive a tunnel');
  assert.ok(html.includes(`/s/${tokAlpha}/api`), 'the API base carries this token');
});

test('each token serves only its own spec', async () => {
  published.set(tokBeta, 'beta');
  const a = await (await fetch(`${base}/s/${tokAlpha}`)).text();
  const b = await (await fetch(`${base}/s/${tokBeta}`)).text();
  assert.match(a, /alpha content/);
  assert.match(b, /beta content/);
  assert.doesNotMatch(a, /beta content/);
  assert.doesNotMatch(b, /alpha content/);
});

test('an unknown token is 404', async () => {
  const r = await fetch(`${base}/s/${newToken()}`);
  assert.equal(r.status, 404);
});

// A distinguishable answer would confirm that a token exists (D7).
test('an unpublished token answers exactly like an unknown one', async () => {
  const revoked = newToken();
  published.set(revoked, 'alpha');
  const before404 = await fetch(`${base}/s/${revoked}`);
  assert.equal(before404.status, 200);
  published.delete(revoked);

  const gone = await fetch(`${base}/s/${revoked}`);
  const never = await fetch(`${base}/s/${newToken()}`);
  assert.equal(gone.status, never.status);
  assert.equal(await gone.text(), await never.text());
});

test('a spec id is not an address', async () => {
  const r = await fetch(`${base}/s/alpha`);
  assert.equal(r.status, 404);
});

test('the daemon routes are not on this socket', async () => {
  for (const path of [
    '/',
    '/spec/alpha',
    '/api/shares',
    '/api/spec/alpha/meta',
    '/api/spec/alpha/comments',
    '/api/prefs',
    '/events?spec=alpha',
  ]) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, 404, `${path} answered ${r.status}`);
  }
});

// fetch normalises `..` out of a path before it leaves the client, so these go
// out over a raw request that sends the path verbatim. Otherwise the test would
// be asserting against the client, not the server.
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method: 'GET', path },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('a traversal cannot escape the token space', async () => {
  for (const path of [
    '/s/../../etc/passwd',
    '/s/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    `/s/${tokAlpha}%2f..%2f${tokBeta}`, // %2f stays encoded, so this is not a token
    `/s/${tokAlpha}/..`,                // normalises to /s/, which names nothing
    '/public/../lib/gateway.mjs',
    '/public/%2e%2e%2fpackage.json',
    `/s/${tokAlpha}/api/../../../api/prefs`,
  ]) {
    const r = await rawGet(path);
    assert.equal(r.status, 404, `${path} answered ${r.status}`);
  }
});

// `new URL` resolves `..` before the route ever sees it, so /s/A/../B is read as
// /s/B. That is not an escape: reaching B still required B's token, which the
// caller had to put in the path. Asserted rather than left implicit, because the
// obvious reading of a 200 here is that a traversal worked.
test('a path that normalises onto another token needs that token anyway', async () => {
  const viaTraversal = await rawGet(`/s/${tokAlpha}/../${tokBeta}`);
  const direct = await rawGet(`/s/${tokBeta}`);
  assert.equal(viaTraversal.status, 200);
  assert.equal(viaTraversal.body, direct.body, 'it is exactly the request it normalised to');

  const unknown = newToken();
  const escape = await rawGet(`/s/${tokAlpha}/../${unknown}`);
  assert.equal(escape.status, 404, 'and it grants nothing the caller did not already hold');
});

test('the review-layer assets are served at the root', async () => {
  const r = await fetch(`${base}/public/review.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);
});

test('the comments API is reachable under a token and writes to that spec', async () => {
  const create = await fetch(`${base}/s/${tokBeta}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: 'a note from a reviewer',
      author: 'lavee',
      anchor: { block: { index: 1, tag: 'P', text: 'beta content' } },
    }),
  });
  assert.equal(create.status, 201);

  const list = await (await fetch(`${base}/s/${tokBeta}/api/comments`)).json();
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].comments[0].author, 'lavee');

  const other = await (await fetch(`${base}/s/${tokAlpha}/api/comments`)).json();
  assert.equal(other.threads.length, 0, 'the write landed on beta only');
});

test('the poll endpoint reports this spec mtimes', async () => {
  const r = await fetch(`${base}/s/${tokAlpha}/api/state`);
  assert.equal(r.status, 200);
  const state = await r.json();
  assert.ok(state.spec > 0);
  assert.equal(typeof state.comments, 'number');
});

test('the API is not reachable without a token', async () => {
  const r = await fetch(`${base}/api/comments`);
  assert.equal(r.status, 404);
});

test('a method the route does not offer is refused, not ignored', async () => {
  const r = await fetch(`${base}/s/${tokAlpha}/api/state`, { method: 'DELETE' });
  assert.equal(r.status, 405);
});

// Deleting a spec through a published link would be the worst possible bug, so
// it gets its own assertion rather than living inside the route sweep above.
test('nothing on this socket can delete, rename or reorganise a spec', async () => {
  for (const [method, path] of [
    ['DELETE', `/s/${tokAlpha}`],
    ['POST', `/s/${tokAlpha}/api/rename`],
    ['PATCH', `/s/${tokAlpha}/api/organize`],
    ['POST', `/s/${tokAlpha}/api/status`],
    ['DELETE', `/s/${tokAlpha}/api`],
  ]) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : '{}',
    });
    assert.ok(r.status === 404 || r.status === 405, `${method} ${path} answered ${r.status}`);
  }
  const still = await fetch(`${base}/s/${tokAlpha}`);
  assert.equal(still.status, 200, 'alpha is still served');
});

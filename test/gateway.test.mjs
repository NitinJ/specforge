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

// Every asset the injected layer names, including the shared UI — a published
// page that cannot load ui.js has no confirm dialog in front of its actions.
test('the review-layer assets are served at the root', async () => {
  for (const [name, type] of [
    ['review.js', /javascript/], ['review.css', /css/],
    ['ui.js', /javascript/], ['ui.css', /css/],
  ]) {
    const r = await fetch(`${base}/public/${name}`);
    assert.equal(r.status, 200, `${name} is served`);
    assert.match(r.headers.get('content-type') || '', type);
  }
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

// Neither of the two tests around this one could catch the bug they bracket: one
// proved the route exists, the other proved the page contains a string, and the
// bug was that the two were different paths. So take the path the page will
// actually ask for out of the page, and ask for it.
test('the path the served page polls is a path this socket answers', async () => {
  const html = await (await fetch(`${base}/s/${tokAlpha}`)).text();
  const m = html.match(/statePath="([^"]+)"/);
  assert.ok(m, 'the page carries the state path it polls');
  const r = await fetch(`${base}${m[1]}`);
  assert.equal(r.status, 200, `the page polls ${m[1]}, which must not 404`);
});

test('the poll endpoint reports this spec mtimes', async () => {
  const r = await fetch(`${base}/s/${tokAlpha}/api/state`);
  assert.equal(r.status, 200);
  const state = await r.json();
  assert.ok(state.spec > 0);
  assert.equal(typeof state.comments, 'number');
});

// The review layer asks for meta on every load. Without it the page falls back
// to defaults, so a published spec reads "draft" whatever its real status, and a
// reviewer who has submitted comments is told "Awaiting response" for as long as
// the agent works. What it must NOT carry is the half of meta that belongs to the
// owner: which session holds the spec, where the Google Doc is, what the share URL
// is. Those drive controls a reader cannot use and this socket does not serve.
test('the meta route serves what a reader reads by, and withholds the owner half', async () => {
  const r = await fetch(`${base}/s/${tokAlpha}/api/meta`);
  assert.equal(r.status, 200);
  const meta = await r.json();
  assert.equal(meta.title, 'alpha');
  assert.equal(meta.status, 'draft');
  assert.ok('reviewProgress' in meta, 'how far the agent has got is the point of the poll');
  for (const owned of ['attachedSession', 'sessionLabel', 'connected', 'export', 'share']) {
    assert.ok(!(owned in meta), `${owned} is the owner's, not the reader's`);
  }
});

// How the author has organised their store is not part of what a shared spec
// discloses, which is the same reason spec pages take theme and font by name
// rather than the whole prefs object. Asserted with the project actually set, so
// the absence is the route withholding it rather than there being nothing to
// withhold.
test('a published copy is never told which project the spec is in', async () => {
  const { readMeta, writeMeta } = await import('../lib/meta.mjs');
  const meta = readMeta('alpha');
  meta.project = 'figur-design-studio';
  writeMeta('alpha', meta);
  assert.equal(readMeta('alpha').project, 'figur-design-studio', 'set on the owner side first');

  const r = await fetch(`${base}/s/${tokAlpha}/api/meta`);
  const body = await r.text();
  assert.equal(!('project' in JSON.parse(body)), true, 'the field is absent from the reader payload');
  assert.equal(body.includes('figur-design-studio'), false, 'and the name appears nowhere in it');
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

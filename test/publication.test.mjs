// The published surface.
//
// A publication is a second listener with one spec id bound at construction.
// Isolation is structural: the other specs are not behind this socket, so the
// test that matters is what the socket answers for everything else.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-pub-'));
process.env.SPECFORGE_HOME = home;

const { createPublicationServer } = await import('../lib/publication.mjs');
const { specDir, specHtmlPath } = await import('../lib/store-paths.mjs');
const { loadComments } = await import('../lib/store-comments.mjs');

const MINE = 'specmine';
const OTHER = 'specother';

function seed(id, title) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${title}</title></head><body><p>${title} body</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title, status: 'draft' }));
}

let server;
let base;

before(async () => {
  seed(MINE, 'mine');
  seed(OTHER, 'other');
  server = createPublicationServer(MINE);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(home, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const anchor = { block: { index: 1, tag: 'P', text: 'mine body' } };

test('the root serves the one spec, with the review layer', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /mine body/);
  assert.match(html, /specforge:review-layer/);
});

// The whole point of a second listener: there is no id to change and nothing
// to enumerate, so the other spec is not reachable by any spelling.
test('no route reaches another spec', async () => {
  for (const p of [
    `/spec/${OTHER}`,
    `/spec/${MINE}`,
    `/api/spec/${OTHER}/comments`,
    `/api/spec/${MINE}/comments`,
    `/api/spec/${OTHER}/meta`,
  ]) {
    assert.equal((await get(p)).status, 404, `${p} must not be served`);
  }
});

test('the index and the store-wide routes are absent', async () => {
  for (const p of ['/index.html', '/healthz', '/api/prefs', '/api/specs']) {
    assert.equal((await get(p)).status, 404, `${p} must not be served`);
  }
});

// Every mutating daemon route that is not a comment must be unreachable, and
// DELETE most of all.
test('destructive and administrative routes are absent', async () => {
  const cases = [
    ['DELETE', `/api/spec/${MINE}`],
    ['POST', `/api/spec/${MINE}/rename`],
    ['PATCH', `/api/spec/${MINE}/organize`],
    ['POST', `/api/spec/${MINE}/status`],
    ['POST', `/api/spec/${MINE}/detach`],
    ['POST', `/api/spec/${MINE}/export`],
    ['DELETE', '/'],
    ['PUT', '/api/prefs'],
    ['PUT', '/api/spec/' + MINE + '/prefs'],
  ];
  for (const [method, p] of cases) {
    const r = await fetch(base + p, { method });
    assert.equal(r.status, 404, `${method} ${p} must not be served`);
  }
});

test('comments can be read and written without a spec id in the path', async () => {
  const created = await post('/api/comments', { anchor, body: 'why 40 bits?', author: 'lavee' });
  assert.equal(created.status, 201);
  const { thread } = await created.json();
  assert.equal(thread.comments[0].author, 'lavee');
  assert.equal(thread.comments[0].kind, 'human');

  const listed = await (await get('/api/comments')).json();
  assert.equal(listed.threads.length, 1);
});

test('a reply and a resolve both work', async () => {
  const { thread } = await (await post('/api/comments', { anchor, body: 'q', author: 'lavee' })).json();
  const r = await post(`/api/comments/${thread.id}/reply`, { body: 'and another thing', author: 'lavee' });
  assert.equal(r.status, 201);
  const res = await post(`/api/comments/${thread.id}/resolve`);
  assert.equal(res.status, 200);
  const t = loadComments(MINE).threads.find((x) => x.id === thread.id);
  assert.equal(t.state, 'resolved');
});

// kind is the one thing a client must not be able to set: it is what separates
// a person from the agent in the rail and in what a submit collects.
test('a client cannot post as the agent', async () => {
  const { thread } = await (await post('/api/comments', {
    anchor, body: 'pretending', author: 'lavee', kind: 'agent',
  })).json();
  assert.equal(thread.comments[0].kind, 'human');
});

test('a reserved name is refused', async () => {
  const r = await post('/api/comments', { anchor, body: 'x', author: 'agent' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reserved/);
});

test('submit works from a publication', async () => {
  await post('/api/comments', { anchor, body: '@agent widen it', author: 'lavee' });
  const r = await post('/api/comments/submit');
  assert.equal(r.status, 201);
  assert.equal((await r.json()).ok, true);
});

test('the block registry is readable and writable', async () => {
  assert.equal((await get('/api/blocks')).status, 200);
  const put = await fetch(base + '/api/blocks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 1, version: 0, seq: 1, byBid: {}, retired: [] }),
  });
  assert.equal(put.status, 200);
});

// A published page cannot hold an event stream (A3), so it asks instead.
test('/api/state reports what a poller needs', async () => {
  const s = await (await get('/api/state')).json();
  assert.equal(typeof s.spec, 'number');
  assert.equal(typeof s.comments, 'number');
  const before = s.spec;
  writeFileSync(specHtmlPath(MINE), '<!DOCTYPE html><html><head><title>mine</title></head><body><p>changed</p></body></html>');
  const after = await (await get('/api/state')).json();
  assert.ok(after.spec >= before, 'a spec edit moves the reported mtime');
});

test('the page is told to poll rather than stream', async () => {
  const html = await (await get('/')).text();
  assert.match(html, /"transport":"poll"/);
  assert.match(html, /"api":"\/api"/);
  assert.doesNotMatch(html, /new EventSource/);
});

test('client assets are served', async () => {
  const r = await get('/public/review.js');
  assert.equal(r.status, 200);
});

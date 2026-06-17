import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { loadComments } from '../lib/store-comments.mjs';
import { listPendingForSpec } from '../lib/store-inbox.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

const anchor = { block: { index: 1, tag: 'P', text: 'the problem' } };

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dcom-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  specId = createSpec({ title: 'A', html: '<h1>A</h1>' });
  server = createDaemon();
  const port = await listen(server);
  base = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  server.close();
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('create + list a comment thread', async () => {
  const c = await post(`/api/spec/${specId}/comments`, { anchor, body: 'why this?' });
  assert.equal(c.status, 201);
  const { thread } = await c.json();
  assert.equal(thread.comments[0].author, 'human');

  const g = await fetch(`${base}/api/spec/${specId}/comments`);
  const { threads } = await g.json();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, thread.id);
});

test('comments API 404s for an unknown spec', async () => {
  const r = await post('/api/spec/deadbeef00/comments', { anchor, body: 'x' });
  assert.equal(r.status, 404);
});

test('reply then resolve a thread', async () => {
  const { thread } = await (await post(`/api/spec/${specId}/comments`, { anchor, body: 'q' })).json();
  const rep = await post(`/api/spec/${specId}/comments/${thread.id}/reply`, { body: 'follow-up' });
  assert.equal(rep.status, 201);
  const res = await post(`/api/spec/${specId}/comments/${thread.id}/resolve`);
  assert.equal(res.status, 200);
  assert.equal(loadComments(specId).threads[0].state, 'resolved');
});

test('submit freezes a pending batch; empty submit is a no-op', async () => {
  await post(`/api/spec/${specId}/comments`, { anchor, body: 'q' });
  const s = await post(`/api/spec/${specId}/comments/submit`);
  assert.equal(s.status, 201);
  const { ok, batch } = await s.json();
  assert.equal(ok, true);
  const pending = listPendingForSpec(specId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].batchId, batch.batchId);

  const again = await post(`/api/spec/${specId}/comments/submit`);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).ok, false);
});

test('SSE /events streams an initial connected comment', async () => {
  const res = await fetch(`${base}/events?spec=${specId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /connected/);
  await reader.cancel();
});

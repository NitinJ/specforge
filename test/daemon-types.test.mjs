// The kind routes over a real socket.
//
// types-api.test.mjs covers the decisions; this covers the wiring: methods,
// status codes, JSON handling, and that the cross-origin guard treats these like
// every other write on the daemon. A route that decides correctly and answers
// 500 is still broken.
//
// Spec 45395008a2, tasks 3.1 and 3.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { seedLiveSession, seedDeadSession } from './helpers/live-session.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specTypes } from '../lib/spec-types.mjs';

let home;
let prevHome;
let server;
let base;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dtypes-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  server = createDaemon();
  base = `http://127.0.0.1:${await listen(server)}`;
});

afterEach(() => {
  server.close();
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const CREATE = { name: 'Postmortem', prompt: 'what happened, timeline, impact' };

test('POST creates the kind and answers where to find it', async () => {
  seedLiveSession({ id: 'sess-a' });
  const r = await post('/api/types', CREATE);
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.slug, 'postmortem');
  assert.equal(body.specUrl, '/spec/template-postmortem');
  assert.equal(body.generate.state, 'requested');
  assert.ok(specTypes().includes('postmortem'));
  assert.equal(readMeta('template-postmortem').attachedSession, 'sess-a');
});

test('GET reports the state, and 404s for a kind nobody made', async () => {
  seedLiveSession();
  await post('/api/types', CREATE);

  const r = await fetch(`${base}/api/types/postmortem`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).generate.state, 'requested');

  assert.equal((await fetch(`${base}/api/types/nope`)).status, 404);
});

test('no live session answers 503 and says what to start', async () => {
  seedDeadSession();
  const r = await post('/api/types', CREATE);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /wait-batch/);
});

test('a duplicate answers 409', async () => {
  seedLiveSession();
  await post('/api/types', CREATE);
  assert.equal((await post('/api/types', CREATE)).status, 409);
});

test('a bad body answers 400 rather than throwing', async () => {
  seedLiveSession();
  assert.equal((await post('/api/types', { prompt: 'no name' })).status, 400);
  assert.equal((await post('/api/types', { name: 'No prompt' })).status, 400);

  const malformed = await fetch(`${base}/api/types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /invalid JSON/);
});

test('the wrong method answers 405 on both routes', async () => {
  seedLiveSession();
  assert.equal((await fetch(`${base}/api/types`)).status, 405);
  await post('/api/types', CREATE);
  assert.equal((await post('/api/types/postmortem', {})).status, 405);
});

test('creating is a write, so a foreign origin is refused', async () => {
  // The same guard every other write on this daemon has. Creating a kind hands
  // work to the owner's own Claude session, which is not something a page on
  // another origin may reach.
  seedLiveSession();
  const r = await post('/api/types', CREATE, { Origin: 'https://attacker.example' });
  assert.equal(r.status, 403);
  assert.equal(specTypes().includes('postmortem'), false, 'and nothing was created');
});

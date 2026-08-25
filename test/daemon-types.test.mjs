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

test('DELETE removes a kind over the socket', async () => {
  seedLiveSession();
  await post('/api/types', CREATE);
  const r = await fetch(`${base}/api/types/postmortem`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).slug, 'postmortem');
  assert.equal(specTypes().includes('postmortem'), false);
  assert.equal((await fetch(`${base}/api/types/postmortem`)).status, 404, 'and it is gone');
});

test('DELETE refuses a built-in, an unknown kind, and one in use', async () => {
  seedLiveSession();
  assert.equal((await fetch(`${base}/api/types/design`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/api/types/nope`, { method: 'DELETE' })).status, 404);

  await post('/api/types', CREATE);
  const { createSpec } = await import('../lib/store.mjs');
  createSpec({ title: 'An outage', html: '<h1>x</h1>', type: 'postmortem' });
  const inUse = await fetch(`${base}/api/types/postmortem`, { method: 'DELETE' });
  assert.equal(inUse.status, 409);
  assert.equal((await inUse.json()).inUse, 1);
});

test('deleting a published template leaves no share record behind', async () => {
  // A template spec is a spec and can be shared, so the delete route revokes
  // first, through the same pubs.unshareThen the spec-delete route uses (raised
  // in review of PR #228). Without it a token is left resolving to a spec that
  // no longer exists.
  //
  // What this test can and cannot say. It catches a delete that stops removing
  // the record — a later change to archive rather than remove, say. It cannot
  // distinguish the revoke from the directory removal, because share.json lives
  // inside the spec directory and either one takes it: the daemon under test is
  // built with createDaemon, which does not restore publications, so there is no
  // in-memory token to watch disappear. The guarantee unshareThen actually buys,
  // that no share can commit anywhere inside a delete, is publications.test.mjs's
  // subject and is covered there.
  seedLiveSession();
  await post('/api/types', CREATE);
  const { writeShare, readShare } = await import('../lib/store-share.mjs');
  writeShare('template-postmortem', { token: 'a'.repeat(32), createdAt: new Date().toISOString() });
  assert.ok(readShare('template-postmortem'), 'published, which is the premise');

  assert.equal((await fetch(`${base}/api/types/postmortem`, { method: 'DELETE' })).status, 200);
  assert.equal(readShare('template-postmortem'), null, 'no record left pointing at it');
});

test('DELETE is a write, so a foreign origin is refused', async () => {
  seedLiveSession();
  await post('/api/types', CREATE);
  const r = await fetch(`${base}/api/types/postmortem`, {
    method: 'DELETE',
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(r.status, 403);
  assert.equal(specTypes().includes('postmortem'), true, 'and the kind is still there');
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

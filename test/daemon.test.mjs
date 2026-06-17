import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { createDaemon, ensureServer } from '../server/daemon.mjs';
import {
  readServerState, clearServerState, releaseLock, isAlive,
} from '../lib/daemon-state.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-daemon-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

// Bind createDaemon() on an ephemeral port; always close in t.after.
async function withDaemon(t, fn) {
  const server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return fn(base);
}

test('GET /healthz returns 200 ok', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), 'ok');
  });
});

test('GET / lists all store specs (ids + titles, linking to /spec/<id>)', async (t) => {
  const a = createSpec({ title: 'Gateway billing', html: '<h1>Gateway billing</h1>' });
  const b = createSpec({ title: 'Share resolution', html: '<h1>Share resolution</h1>' });
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Gateway billing/);
    assert.match(body, /Share resolution/);
    assert.match(body, new RegExp(`/spec/${a}`));
    assert.match(body, new RegExp(`/spec/${b}`));
    // unattached spec shows as "free"
    assert.match(body, /free/);
  });
});

test('GET / shows attached label for an attached spec', async (t) => {
  const id = createSpec({ title: 'Attached one', html: '<h1>Attached one</h1>' });
  // Attach by writing meta directly (Stage 3 owns attach() — here we only render).
  const { readMeta, writeMeta } = await import('../lib/meta.mjs');
  const m = readMeta(id);
  writeMeta(id, { ...m, attachedSession: 'abcdef1234567890' });
  await withDaemon(t, async (base) => {
    const body = await (await fetch(`${base}/`)).text();
    assert.match(body, /session abcdef12/); // short id
  });
});

test('GET /spec/<id> serves the spec html with the review layer injected', async (t) => {
  const id = createSpec({
    title: 'Sample Spec',
    html: '<!doctype html><html><head><title>Sample Spec</title></head><body><h1>Sample Spec</h1></body></html>',
  });
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/spec/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Sample Spec/);
    assert.match(body, /specforge:review-layer/); // injected review layer marker
    assert.match(body, /\/public\/review\.js/);
  });
});

test('GET /spec/<unknown> returns 404', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/spec/deadbeef00`);
    assert.equal(res.status, 404);
  });
});

test('ensureServer is a singleton: a second call reuses the same port', async (t) => {
  createSpec({ title: 'One', html: '<h1>One</h1>' });

  const first = await ensureServer({ port: 0 });
  assert.ok(first.server, 'first call starts a server');
  t.after(() => {
    if (first.server) return new Promise((r) => first.server.close(r));
  });
  t.after(() => { clearServerState(); releaseLock(); });

  // server.json advertises the running daemon.
  const state = readServerState();
  assert.equal(state.port, first.port);
  assert.ok(isAlive(state.pid));

  const second = await ensureServer({ port: 0 });
  assert.equal(second.server, null, 'second call reuses, does not start a server');
  assert.equal(second.url, first.url);
  assert.equal(second.port, first.port);

  // The reused daemon answers.
  const res = await fetch(`${first.url}healthz`);
  assert.equal(res.status, 200);
});

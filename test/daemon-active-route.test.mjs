// POST /api/spec/:id/active — the only writer of the active harness.
//
// It is reached only from the browser, which is a person (I7b). That is what
// makes E8 true: nothing an agent does can take work from another, or strand a
// spec by crashing while it holds it.
//
// It has its own file because the route is what the switcher talks to, and the
// unit tests around setActive() cannot see the route at all: a first version of
// this endpoint called a body reader that did not exist, and every test stayed
// green while the daemon died on the first click.
//
// Spec e9ddcddef6, task 6.4.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { attach } from '../lib/attach.mjs';
import { connect, activeHarnessOf } from '../lib/connections.mjs';
import { readMeta } from '../lib/meta.mjs';

let home;
let prevHome;
let server;
let base;
let specId;

const listen = (srv) =>
  new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-active-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  specId = createSpec({ title: 'Shared', html: '<h1>Shared</h1>' });
  attach(specId, 'claude:c1');
  connect(specId, 'pi:p1');
  server = createDaemon();
  base = `http://127.0.0.1:${await listen(server)}`;
});

afterEach(() => {
  server.close();
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const setActive = (id, body, method = 'POST') => fetch(`${base}/api/spec/${id}/active`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('it hands the spec to another connected harness', async () => {
  const r = await setActive(specId, { harness: 'pi' });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.ok, true);
  assert.equal(out.activeHarness, 'pi');
  assert.equal(out.changed, true);
  assert.equal(activeHarnessOf(readMeta(specId)), 'pi', 'and the store agrees');
});

test('the answer carries what the header needs to redraw itself', async () => {
  // The client patches state.meta from this rather than reloading, so a field
  // missing here is a switcher that vanishes after a successful switch.
  const out = await (await setActive(specId, { harness: 'pi' })).json();
  assert.deepEqual(out.harnesses.map((h) => [h.harness, h.active]), [
    ['claude', false], ['pi', true],
  ]);
  assert.equal(typeof out.sessionLabel, 'string');
});

test('switching to the harness already working it is a 200, not an error', async () => {
  const out = await (await setActive(specId, { harness: 'claude' })).json();
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
});

test('a harness that is not connected is refused, and nothing moves', async () => {
  const r = await setActive(specId, { harness: 'codex' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /not connected/);
  assert.equal(activeHarnessOf(readMeta(specId)), 'claude');
});

test('a body with no harness is a 400', async () => {
  assert.equal((await setActive(specId, {})).status, 400);
});

test('a body that is not JSON is a 400, not a crash', async () => {
  const r = await fetch(`${base}/api/spec/${specId}/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{nope',
  });
  assert.equal(r.status, 400);
});

test('an unknown spec is a 404', async () => {
  assert.equal((await setActive('deadbeef00', { harness: 'pi' })).status, 404);
});

test('only POST reaches it', async () => {
  const r = await fetch(`${base}/api/spec/${specId}/active`, { method: 'PATCH' });
  assert.equal(r.status, 405);
  assert.equal(activeHarnessOf(readMeta(specId)), 'claude');
});

test('the daemon is still serving after all of that', async () => {
  // The crash this file exists for killed the process, so every later assertion
  // in a shared file would have failed for the wrong reason.
  const r = await fetch(`${base}/api/spec/${specId}/meta`);
  assert.equal(r.status, 200);
});

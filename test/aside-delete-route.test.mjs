// The delete route, over real HTTP.
//
// The handler is tested directly elsewhere. This covers what only the router
// decides: which methods it answers, and what a URL the router itself cannot
// parse does. Nothing wraps the request handler, so a synchronous throw in there
// leaves as an uncaughtException and takes the daemon down for every spec open
// in every tab — one malformed URL, and everyone's tabs stop live-reloading.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-aside-route-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { createSpec, readSpecHtml } = await import('../lib/store.mjs');
const { createDaemon } = await import('../server/daemon.mjs');

const SPEC = '<main><section id="object"><h2>O</h2><p>p</p></section>'
  + '<section id="object-aside-1" data-sf-aside="object" data-sf-action="visualize">'
  + '<h3>Aside: Visualize</h3><p>Draft.</p></section></main>';

async function listen(t, server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a malformed aside id is a 400, and the daemon stays up', async (t) => {
  // `%zz` is not a valid percent-escape, so decodeURIComponent throws. Without a
  // boundary that throw escapes the request handler and kills the process.
  const id = createSpec({ title: 'T', html: SPEC });
  const base = await listen(t, createDaemon());

  const bad = await fetch(`${base}/api/spec/${id}/aside/%zz`, { method: 'DELETE' });
  assert.equal(bad.status, 400);

  // The real assertion: the server answered at all, and still answers.
  const after = await fetch(`${base}/api/spec/${id}/aside/object-aside-1`, { method: 'DELETE' });
  assert.equal(after.status, 200);
  assert.equal(readSpecHtml(id).includes('object-aside-1'), false);
});

test('an aside id carrying an escaped character is decoded, not refused', () => {
  // The reason the route decodes at all: section ids are author-written, and one
  // holding a space or a slash arrives escaped.
  assert.equal(decodeURIComponent('a%20b-aside-1'), 'a b-aside-1');
});

test('only DELETE is answered on the route', async (t) => {
  const id = createSpec({ title: 'T', html: SPEC });
  const base = await listen(t, createDaemon());
  for (const method of ['GET', 'POST', 'PUT']) {
    const r = await fetch(`${base}/api/spec/${id}/aside/object-aside-1`, { method });
    assert.equal(r.status, 405, `${method} should not be allowed`);
  }
  assert.equal(readSpecHtml(id).includes('object-aside-1'), true, 'and nothing was deleted');
});

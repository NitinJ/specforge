// How the review layer's client assets are served.
//
// This became worth its own file when the vendored diagram renderer landed:
// prism.js is 34 KB and mermaid.js is 3.4 MB, and the route used to answer
// `Cache-Control: no-store`, which forbids keeping a copy at all. A spec being
// edited live-reloads on every save, so that is the whole bundle again on every
// keystroke-to-disk. Revalidation costs a 304 and is equally safe.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon } from '../server/daemon.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-static-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

async function withDaemon(t, fn) {
  const server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return fn(`http://127.0.0.1:${server.address().port}`);
}

test('a vendored asset is served with a content ETag, not no-store', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/public/review.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.match(res.headers.get('etag') || '', /^"[0-9a-f]{16}"$/);
    assert.ok((await res.text()).length > 0);
  });
});

test('an unchanged asset revalidates to 304 with no body', async (t) => {
  await withDaemon(t, async (base) => {
    const first = await fetch(`${base}/public/review.css`);
    const etag = first.headers.get('etag');
    const body = await first.text();
    assert.ok(body.length > 0);

    const second = await fetch(`${base}/public/review.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get('etag'), etag);
    assert.equal((await second.text()).length, 0, 'a 304 carries no body; that is the whole point');
  });
});

test('a stale validator gets the whole file back', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/public/review.css`, { headers: { 'If-None-Match': '"0000000000000000"' } });
    assert.equal(res.status, 200);
    assert.ok((await res.text()).length > 0);
  });
});

test('two different assets do not share a validator', async (t) => {
  await withDaemon(t, async (base) => {
    const a = await fetch(`${base}/public/review.js`);
    const b = await fetch(`${base}/public/review.css`);
    assert.notEqual(a.headers.get('etag'), b.headers.get('etag'));
  });
});

test('a missing asset is 404, and so is one with an extension we do not serve', async (t) => {
  await withDaemon(t, async (base) => {
    assert.equal((await fetch(`${base}/public/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/public/review.html`)).status, 404);
  });
});

test('the route cannot be walked out of server/public', async (t) => {
  await withDaemon(t, async (base) => {
    // The path pattern only admits [\w.-]+, and serveStatic takes the basename
    // on top of that. Both halves are asserted, because either alone would be a
    // traversal away from serving the whole disk.
    for (const attempt of ['..%2f..%2fpackage.json', '%2e%2e%2fpackage.json', 'sub%2ffile.js']) {
      const res = await fetch(`${base}/public/${attempt}`);
      assert.equal(res.status, 404, `${attempt} must not resolve`);
    }
  });
});

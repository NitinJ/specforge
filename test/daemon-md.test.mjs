// GET /api/spec/<id>/md — the route behind the review UI's download row.
//
// It is checked against a real listening daemon rather than by calling the
// handler, because what is being asserted is the response: the content type, the
// filename the browser will use, and that a zip arrives exactly when the spec has
// diagrams to carry.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixture } from './fixtures/md/index.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { createSpec } from '../lib/store.mjs';
import { createDaemon } from '../server/daemon.mjs';

const store = useTempStore({ beforeEach, afterEach }, 'sf-daemonmd-');

let server;
let base;

beforeEach(async () => {
  server = createDaemon();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const seed = (name, title, type = 'design') =>
  createSpec({ html: fixture(name).html(), title, type });

test('a spec with no diagrams downloads as markdown', async () => {
  const id = seed('design', 'Retry policy');
  const res = await fetch(`${base}/api/spec/${id}/md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/markdown/);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="retry-policy.md"');

  const body = await res.text();
  assert.match(body, /^---\n/, 'frontmatter');
  assert.match(body, /^# Retry policy for webhook delivery$/m);
  assert.match(body, new RegExp(`specforge_id: ${id}`));
});

test('a spec with diagrams downloads as a zip carrying them', async () => {
  const id = seed('diagrams', 'Topology');
  const res = await fetch(`${base}/api/spec/${id}/md`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="topology.zip"');

  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(res.headers.get('content-length'), String(buf.length), 'the length is declared');
  assert.equal(buf.readUInt32LE(0), 0x04034b50, 'a zip, not markdown');
  assert.ok(buf.includes(Buffer.from('topology.md')));
  assert.ok(buf.includes(Buffer.from('topology.assets/architecture-1.svg')));
  assert.ok(buf.includes(Buffer.from('topology.assets/flow-1.svg')));
});

test('the zip the route produces is one unzip accepts', async (t) => {
  if (spawnSync('unzip', ['-v']).status !== 0) return t.skip('no unzip on this machine');
  const id = seed('diagrams', 'Topology');
  const res = await fetch(`${base}/api/spec/${id}/md`);
  const dir = mkdtempSync(join(tmpdir(), 'sf-dlzip-'));
  try {
    const path = join(dir, 'out.zip');
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    const check = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown spec is a 404 with a reason, not a stack trace', async () => {
  const res = await fetch(`${base}/api/spec/deadbeef00/md`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /unknown spec deadbeef00/);
});

test('a deck spec is refused with the reason', async () => {
  const id = createSpec({ html: fixture('design').html(), title: 'Slides', type: 'deck' });
  const res = await fetch(`${base}/api/spec/${id}/md`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /slide-shaped and have no markdown form/);
});

test('the download is a rendering, not a stored file: an edit shows up at once', async () => {
  const id = seed('design', 'Retry policy');
  const first = await (await fetch(`${base}/api/spec/${id}/md`)).text();
  assert.doesNotMatch(first, /A late amendment/);

  const { writeSpecHtml, readSpecHtml } = await import('../lib/store.mjs');
  writeSpecHtml(id, readSpecHtml(id).replace('</section>', '<p>A late amendment</p></section>'));

  const second = await (await fetch(`${base}/api/spec/${id}/md`)).text();
  assert.match(second, /A late amendment/, 'no stale copy sitting in the spec directory');
});

test('a title that slugs to nothing still yields a usable filename', async () => {
  const id = seed('design', '???');
  const res = await fetch(`${base}/api/spec/${id}/md`);
  const disposition = res.headers.get('content-disposition');
  assert.match(disposition, /^attachment; filename="[\w.-]+\.md"$/, disposition);
});

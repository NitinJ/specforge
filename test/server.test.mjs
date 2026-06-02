import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { createApp } from '../server/app.mjs';
import { specId, buildIndex, resolveSpec } from '../lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

function makeSpecsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-srv-'));
  const file = join(dir, '2026-06-02-sample-spec.html');
  writeFileSync(file, TEMPLATE.replace('{{TITLE}}', 'Sample Spec'));
  return { dir, file };
}

async function withServer(specsDir, fn) {
  const server = createApp({ specsDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('paths: specId is stable and buildIndex/resolveSpec find specs', () => {
  const { dir, file } = makeSpecsDir();
  const rel = relative(dir, file);
  assert.equal(specId(rel), specId(rel));
  const index = buildIndex(dir);
  assert.equal(index.length, 1);
  assert.equal(index[0].title, 'Sample Spec');
  assert.ok(resolveSpec(dir, index[0].id));
  assert.equal(resolveSpec(dir, 'deadbeef00'), null);
});

test('GET / lists specs', async () => {
  const { dir } = makeSpecsDir();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Sample Spec/);
    assert.match(body, /\/spec\//);
  });
});

test('GET /healthz returns ok', async () => {
  const { dir } = makeSpecsDir();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), 'ok');
  });
});

test('GET /spec/:id serves the spec with the review layer injected', async () => {
  const { dir } = makeSpecsDir();
  const id = buildIndex(dir)[0].id;
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/spec/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /specforge:review-layer/); // injected live-reload client
    assert.match(body, /EventSource\('\/events/);
    assert.match(body, /id="task-tracker"/); // tracker section preserved
    assert.match(body, /Sample Spec/);
  });
});

test('GET /spec/:badid returns 404', async () => {
  const { dir } = makeSpecsDir();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/spec/deadbeef00`);
    assert.equal(res.status, 404);
  });
});

test('GET /events opens an SSE stream', async () => {
  const { dir } = makeSpecsDir();
  const id = buildIndex(dir)[0].id;
  await withServer(dir, async (base) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/events?spec=${id}`, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    ctrl.abort(); // don't hang on the open stream
  });
});

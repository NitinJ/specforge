import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { writeServerState, readServerState, clearServerState } from '../lib/server-state.mjs';
import { createApp } from '../server/app.mjs';
import { buildIndex } from '../lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const START = join(ROOT, 'server', 'start.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

function specsDirWith(name = 'a-spec.html') {
  const dir = mkdtempSync(join(tmpdir(), 'sf-state-'));
  writeFileSync(join(dir, name), TEMPLATE);
  return { dir, file: join(dir, name) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('server-state: write / read / clear round-trips', () => {
  const { dir } = specsDirWith();
  writeServerState(dir, { port: 4200, pid: 123, url: 'http://127.0.0.1:4200/' });
  assert.equal(readServerState(dir).port, 4200);
  clearServerState(dir);
  assert.equal(readServerState(dir), null);
});

test('--resolve uses the bound port from server.json, not the configured port', () => {
  const { dir, file } = specsDirWith();
  writeServerState(dir, { port: 51999, pid: 1, url: 'http://127.0.0.1:51999/' });
  const res = spawnSync(process.execPath, [START, '--specs-dir', dir, '--resolve', file], {
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.ifError(res.error);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /:51999\/spec\//);
});

test('SSE: a file change after the client disconnects does not crash the server', async () => {
  const { dir, file } = specsDirWith();
  const id = buildIndex(dir)[0].id;
  const server = createApp({ specsDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ctrl = new AbortController();
    const sse = await fetch(`${base}/events?spec=${id}`, { signal: ctrl.signal });
    assert.equal(sse.status, 200);
    ctrl.abort();
    await sleep(150);
    appendFileSync(file, '\n<!-- touch -->');
    await sleep(250);
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200); // process still alive
  } finally {
    await new Promise((r) => server.close(r));
  }
});

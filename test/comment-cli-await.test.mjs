// Stage 2.1 — the agent-side `comment-cli await` long-poll. It reads the running
// server's port from server.json, hits GET /await, and prints the batch JSON or
// `empty`; it exits non-zero (no crash) when no server is running.
//
// The server runs in-process, so the CLI is spawned ASYNC (spawn, not spawnSync)
// — a blocking spawn would freeze this process's event loop and the server could
// never answer the CLI's request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import { createApp } from '../server/app.mjs';
import { buildIndex } from '../lib/paths.mjs';
import { writeServerState } from '../lib/server-state.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'comment-cli.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const anchor = { block: { index: 1, tag: 'P', text: 'The problem and its context' } };

function specsDirWith() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cliawait-'));
  writeFileSync(join(dir, 's-spec.html'), TEMPLATE.replace('{{TITLE}}', 'CLI Await Spec'));
  return { dir, id: buildIndex(dir)[0].id };
}
async function withServer(specsDir, fn) {
  const server = createApp({ specsDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base, port); } finally { await new Promise((r) => server.close(r)); }
}
const postJSON = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function runCli(args) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [CLI, ...args]);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, out: out.trim(), err: err.trim() }));
  });
}

test('await drains a pending batch and prints it as JSON', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base, port) => {
    writeServerState(dir, { port, pid: process.pid, url: base + '/' });
    await postJSON(base, `/api/spec/${id}/comments`, { anchor, body: 'why?' });
    const submitted = (await (await postJSON(base, `/api/spec/${id}/comments/submit`, {})).json()).batch;
    const { code, out } = await runCli(['await', dir, id, '2000']);
    assert.equal(code, 0, 'await exits 0 on a delivered batch');
    assert.equal(JSON.parse(out).batchId, submitted.batchId);
  });
});

test('await prints "empty" when the long-poll times out', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base, port) => {
    writeServerState(dir, { port, pid: process.pid, url: base + '/' });
    const { code, out } = await runCli(['await', dir, id, '100']);
    assert.equal(code, 0);
    assert.equal(out, 'empty');
  });
});

test('await surfaces a server error (unknown spec) instead of faking empty', async () => {
  const { dir } = specsDirWith();
  await withServer(dir, async (base, port) => {
    writeServerState(dir, { port, pid: process.pid, url: base + '/' });
    const { code, out, err } = await runCli(['await', dir, 'no-such-spec', '100']);
    assert.notEqual(code, 0, 'non-zero on a server error');
    assert.notEqual(out, 'empty', 'a 404 must not masquerade as a timeout');
    assert.match(err, /\b404\b/);
  });
});

test('await exits non-zero (no crash) when no server is running', async () => {
  const { dir, id } = specsDirWith(); // no server.json written
  const { code, err } = await runCli(['await', dir, id, '100']);
  assert.notEqual(code, 0, 'non-zero so the review loop stops');
  assert.match(err, /no review server/i);
});

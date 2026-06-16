// API-level tests for the long-poll await endpoint (Stage 1.2): a parked
// GET /await is resolved in real time by a human submit (publish), times out to
// {batch:null}, and drains an already-pending inbox batch without parking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApp } from '../server/app.mjs';
import { buildIndex } from '../lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const anchor = { block: { index: 1, tag: 'P', text: 'The problem and its context' } };

function specsDirWith() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-await-'));
  writeFileSync(join(dir, 's-spec.html'), TEMPLATE.replace('{{TITLE}}', 'Await Spec'));
  return { dir, id: buildIndex(dir)[0].id };
}
async function withServer(specsDir, fn) {
  const server = createApp({ specsDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const postJSON = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('GET /await parks, then a human submit delivers the batch in real time', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    await postJSON(base, `/api/spec/${id}/comments`, { anchor, body: 'why?' });
    // Park the long-poll, give it a beat to register as a waiter, then submit.
    const awaiting = fetch(`${base}/api/spec/${id}/await?timeout=5000`);
    await new Promise((r) => setTimeout(r, 100));
    const submitted = (await (await postJSON(base, `/api/spec/${id}/comments/submit`, {})).json()).batch;
    const delivered = (await (await awaiting).json()).batch;
    assert.ok(delivered, 'await resolves with a batch');
    assert.equal(delivered.batchId, submitted.batchId, 'same batch delivered to the parked poll');
  });
});

test('GET /await times out to {batch:null} when nothing is submitted', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    const r = await fetch(`${base}/api/spec/${id}/await?timeout=50`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).batch, null);
  });
});

test('GET /await drains an already-pending inbox batch without parking', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    await postJSON(base, `/api/spec/${id}/comments`, { anchor, body: 'c' });
    const submitted = (await (await postJSON(base, `/api/spec/${id}/comments/submit`, {})).json()).batch;
    // Nobody parked; the next poll must return the pending batch at once (well before timeout).
    const drained = (await (await fetch(`${base}/api/spec/${id}/await?timeout=50`)).json()).batch;
    assert.ok(drained, 'pending batch drained');
    assert.equal(drained.batchId, submitted.batchId);
  });
});

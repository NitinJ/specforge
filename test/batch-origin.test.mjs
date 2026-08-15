// Where a review batch came from.
//
// A batch submitted through a share is a reviewer's; one submitted from the
// owner's loopback daemon is the owner's. The distinction is what lets the
// review skill answer a reviewer without editing the document on their say-so
// (spec 82f5dabccf, R3/D3), so it is recorded at submit and immutable after,
// like everything else a batch freezes.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-batch-origin-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { submitBatch, listPendingForSpec, BATCH_ORIGINS } = await import('../lib/store-inbox.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { mutateComments, createThread, addComment } = await import('../lib/store-comments.mjs');
const { createDaemon } = await import('../server/daemon.mjs');
const { createGatewayServer } = await import('../lib/gateway.mjs');
const { newToken } = await import('../lib/tokens.mjs');
const { inboxDir } = await import('../lib/store-paths.mjs');

/** A spec with one thread addressed to the agent, ready to submit. */
function seedThread(title = 'Spec') {
  const id = createSpec({ title, html: '<h1>x</h1><p>a paragraph</p>' });
  mutateComments(id, (store) => {
    const t = createThread(store, {
      body: '@agent why polling here?',
      author: 'mira',
      anchor: { block: { index: 1, tag: 'P', text: 'a paragraph' } },
    });
    return t;
  });
  return id;
}

test('a batch records the origin it was submitted through', () => {
  const id = seedThread();
  const batch = submitBatch(id, '2026-08-15T00:00:00Z', { origin: 'share' });
  assert.equal(batch.origin, 'share');
  // And it is on disk, which is what the review skill reads.
  const onDisk = JSON.parse(readFileSync(join(inboxDir(id), `${batch.batchId}.json`), 'utf8'));
  assert.equal(onDisk.origin, 'share');
});

test('the default origin is the owner, so nothing existing changes meaning', () => {
  const id = seedThread();
  const batch = submitBatch(id);
  assert.equal(batch.origin, 'daemon');
});

test('an unknown origin is refused rather than recorded', () => {
  const id = seedThread();
  assert.throws(() => submitBatch(id, '2026-08-15T00:00:00Z', { origin: 'somewhere' }),
    /origin must be one of/);
  assert.deepEqual(listPendingForSpec(id), [], 'and nothing was frozen');
});

test('BATCH_ORIGINS names exactly the two paths a batch can arrive by', () => {
  assert.deepEqual([...BATCH_ORIGINS].sort(), ['daemon', 'share']);
});

test('a batch read back from disk keeps its origin', () => {
  const id = seedThread();
  submitBatch(id, '2026-08-15T00:00:00Z', { origin: 'share' });
  const [pending] = listPendingForSpec(id);
  assert.equal(pending.origin, 'share');
});

// A batch missing the field predates it. Read as the owner's, because that is
// what every batch was before reviewers could submit, and reading it as a
// reviewer's would silently stop the agent editing on an old batch.
test('a batch written before this field reads as the owner', () => {
  const id = seedThread();
  const batch = submitBatch(id);
  const file = join(inboxDir(id), `${batch.batchId}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  delete raw.origin;
  writeFileSync(file, JSON.stringify(raw));
  assert.equal(listPendingForSpec(id)[0].origin, 'daemon');
});

// ---------------------------------------------------------------- wiring

/** Bind a server on an ephemeral port and hand back its base URL. */
async function listen(t, server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('the daemon submits as the owner', async (t) => {
  const id = seedThread();
  const base = await listen(t, createDaemon());
  const r = await fetch(`${base}/api/spec/${id}/comments/submit`, { method: 'POST' });
  assert.equal(r.status, 201);
  const { batch } = await r.json();
  assert.equal(batch.origin, 'daemon');
});

test('the gateway submits as a reviewer, on both address schemes', async (t) => {
  const specTok = newToken();
  const projTok = newToken();
  const viaSpec = seedThread('Via spec token');
  const viaProject = seedThread('Via project token');
  // The project-scoped spec has to be in the project the token resolves to.
  const { readMeta, writeMeta } = await import('../lib/meta.mjs');
  const meta = readMeta(viaProject);
  meta.project = 'atelier';
  writeMeta(viaProject, meta);

  const base = await listen(t, createGatewayServer(
    (tk) => (tk === specTok ? viaSpec : null),
    (tk) => (tk === projTok ? 'atelier' : null),
  ));

  const a = await fetch(`${base}/s/${specTok}/api/comments/submit`, { method: 'POST' });
  assert.equal(a.status, 201);
  assert.equal((await a.json()).batch.origin, 'share');

  const b = await fetch(`${base}/p/${projTok}/spec/${viaProject}/api/comments/submit`, { method: 'POST' });
  assert.equal(b.status, 201);
  assert.equal((await b.json()).batch.origin, 'share');
});

test('the comments CLI surfaces the origin, which is what the skill branches on', async () => {
  const id = seedThread();
  submitBatch(id, '2026-08-15T00:00:00Z', { origin: 'share' });
  const { cmdComments } = await import('../lib/specforge-cli.mjs');
  const out = await cmdComments({ id });
  assert.equal(out.pending[0].origin, 'share');
});

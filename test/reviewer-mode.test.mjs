// Reviewer mode: what a share-origin batch may and may not cause.
//
// The rule (spec 82f5dabccf, R3): the agent answers a reviewer's question but
// never amends the document on it. Edit authority stays with the owner, who
// promotes a thread by re-tagging @agent from their own loopback page.
//
// Two layers hold that rule. The gateway offers no route that writes spec.html
// and none that resolves a thread — structural, tested here. The reply-only
// behaviour is the skill's, so what is testable is the contract it branches on:
// the batch carries its origin, and the review flow's own verbs (reply,
// batch-working, batch-done) leave the document untouched.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-reviewer-mode-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { createSpec, specHtmlPath } = await import('../lib/store.mjs');
const { createGatewayServer } = await import('../lib/gateway.mjs');
const { newToken } = await import('../lib/tokens.mjs');
const { mutateComments, createThread, loadComments } = await import('../lib/store-comments.mjs');
const { readMeta, writeMeta } = await import('../lib/meta.mjs');
const { cmdReply, cmdBatchDone, cmdBatchWorking, cmdComments } = await import('../lib/specforge-cli.mjs');

function seed({ project = null } = {}) {
  const id = createSpec({ title: 'Under review', html: '<h1>x</h1><p>a paragraph</p>' });
  if (project) {
    const m = readMeta(id);
    m.project = project;
    writeMeta(id, m);
  }
  mutateComments(id, (store) => createThread(store, {
    body: '@agent why polling here?',
    author: 'mira',
    anchor: { block: { index: 1, tag: 'P', text: 'a paragraph' } },
  }));
  return id;
}

async function listen(t, server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a reviewer cannot resolve a thread through either share surface', async (t) => {
  const specTok = newToken();
  const projTok = newToken();
  const viaSpec = seed();
  const viaProject = seed({ project: 'atelier' });
  const base = await listen(t, createGatewayServer(
    (tk) => (tk === specTok ? viaSpec : null),
    (tk) => (tk === projTok ? 'atelier' : null),
  ));

  const specThread = loadComments(viaSpec).threads[0].id;
  const projThread = loadComments(viaProject).threads[0].id;

  const a = await fetch(`${base}/s/${specTok}/api/comments/${specThread}/resolve`, { method: 'POST' });
  const b = await fetch(`${base}/p/${projTok}/spec/${viaProject}/api/comments/${projThread}/resolve`, { method: 'POST' });
  assert.equal(a.status, 404, 'resolve is the owner’s verdict, not a reviewer’s');
  assert.equal(b.status, 404);

  assert.equal(loadComments(viaSpec).threads[0].state, 'open');
  assert.equal(loadComments(viaProject).threads[0].state, 'open');
});

test('the owner can still resolve from their own daemon', async (t) => {
  const { createDaemon } = await import('../server/daemon.mjs');
  const id = seed();
  const base = await listen(t, createDaemon());
  const tid = loadComments(id).threads[0].id;
  const r = await fetch(`${base}/api/spec/${id}/comments/${tid}/resolve`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(loadComments(id).threads[0].state, 'resolved');
});

test('no route on the share surface writes the document', async (t) => {
  const specTok = newToken();
  const id = seed();
  const base = await listen(t, createGatewayServer((tk) => (tk === specTok ? id : null)));
  const before = statSync(specHtmlPath(id)).mtimeMs;
  const html = readFileSync(specHtmlPath(id), 'utf8');

  // Every write-shaped verb a reviewer could reach for.
  for (const [method, path, body] of [
    ['PUT', `/s/${specTok}`, '<h1>owned</h1>'],
    ['POST', `/s/${specTok}/api/spec`, '{}'],
    ['PUT', `/s/${specTok}/api/spec`, '{}'],
    ['POST', `/s/${specTok}/api/rename`, '{"title":"mine"}'],
    ['PATCH', `/s/${specTok}/api/organize`, '{"project":"mine"}'],
    ['POST', `/s/${specTok}/api/status`, '{"status":"approved"}'],
    ['DELETE', `/s/${specTok}`, undefined],
  ]) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.ok(r.status === 404 || r.status === 405, `${method} ${path} answered ${r.status}`);
  }

  assert.equal(statSync(specHtmlPath(id)).mtimeMs, before, 'the document did not move');
  assert.equal(readFileSync(specHtmlPath(id), 'utf8'), html);
});

test('a full reply round on a share batch leaves the document untouched', async (t) => {
  const specTok = newToken();
  const id = seed();
  const base = await listen(t, createGatewayServer((tk) => (tk === specTok ? id : null)));

  // The reviewer submits; the agent then does everything reviewer mode allows.
  const submitted = await fetch(`${base}/s/${specTok}/api/comments/submit`, { method: 'POST' });
  const { batch } = await submitted.json();
  assert.equal(batch.origin, 'share');

  const before = statSync(specHtmlPath(id)).mtimeMs;
  const pending = await cmdComments({ id });
  assert.equal(pending.pending[0].origin, 'share', 'the skill reads the origin here');

  await cmdBatchWorking({ id, batchId: batch.batchId });
  await cmdReply({ id, tid: pending.threads[0].id, body: 'Because the tunnel buffers event streams.' });
  await cmdBatchDone({ id, batchId: batch.batchId });

  assert.equal(statSync(specHtmlPath(id)).mtimeMs, before,
    'answering a reviewer never moves the document');
  const thread = loadComments(id).threads[0];
  assert.equal(thread.comments.at(-1).kind, 'agent');
  // `replied`, never `resolved`: answering is the agent's, closing is the
  // owner's, and reviewer mode does not change which is which.
  assert.equal(thread.state, 'replied');
});

test('the skill is told to branch on origin, and what each branch may do', async () => {
  const skill = readFileSync(
    new URL('../skills/review-spec/SKILL.md', import.meta.url), 'utf8',
  );
  assert.match(skill, /origin/, 'the skill reads the batch origin');
  assert.match(skill, /reply-only|reply only/i);
  // The rule that matters: no Edit on a share batch, and promotion is the
  // owner re-tagging rather than the agent deciding.
  assert.match(skill, /share/);
  assert.match(skill, /Edit/);
});

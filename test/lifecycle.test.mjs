import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec, readSpecHtml } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { setStatus, STATUSES } from '../lib/lifecycle.mjs';
import { cmdStatus } from '../lib/specforge-cli.mjs';
import { mutateComments, createThread, addComment, resolveThread } from '../lib/store-comments.mjs';

const BADGE_HTML = '<html data-sf-spec-status="draft"><body>status: <span class="b">draft</span><h1>A</h1></body></html>';
const ANCHOR = { block: { index: 0, tag: 'P', text: 'x', sectionPath: [] } };

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-life-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** Open a thread on a spec and return its id. */
function comment(id, body = 'a note') {
  return mutateComments(id, (s) => createThread(s, { anchor: ANCHOR, body, author: 'human' }).id);
}

test('the lifecycle is two states, draft and approved', () => {
  assert.deepEqual(STATUSES, ['draft', 'approved']);
});

test('setStatus writes meta + the spec HTML badge', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  setStatus(id, 'approved');
  assert.equal(readMeta(id).status, 'approved');
  const html = readSpecHtml(id);
  assert.match(html, /data-sf-spec-status="approved"/);
  assert.match(html, /status: <span[^>]*>approved<\/span>/);
});

test('setStatus rejects an invalid status and an unknown spec', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  assert.throws(() => setStatus(id, 'bogus'), /invalid status/);
  assert.throws(() => setStatus('deadbeef00', 'approved'), /unknown spec/);
});

// The states the lifecycle used to have. They are not merely unused now — they
// must be refused, or a stale caller could still write one into meta.json and
// the UI would render a status it has no rules for.
test('the retired statuses are rejected', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  for (const s of ['in_review', 'implementing', 'done', 'closed']) {
    assert.throws(() => setStatus(id, s), /invalid status/, `${s} is gone`);
  }
});

test('cmdStatus validates and returns the new status', async () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  const r = await cmdStatus({ id, status: 'approved' });
  assert.deepEqual(r, { ok: true, id, status: 'approved' });
  await assert.rejects(() => cmdStatus({ id, status: 'nope' }), /invalid status/);
});

// ---------- approval does not survive an open comment ----------

test('a new comment on an approved spec sends it back to draft', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  setStatus(id, 'approved');
  comment(id);
  assert.equal(readMeta(id).status, 'draft', 'an unresolved objection revokes the approval');
  assert.match(readSpecHtml(id), /data-sf-spec-status="draft"/, 'and the badge follows');
});

test('resolving the last thread does not re-approve on its own', () => {
  // Approval is a human act. Auto-promoting on resolve would approve a spec
  // nobody looked at again.
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  setStatus(id, 'approved');
  const tid = comment(id);
  assert.equal(readMeta(id).status, 'draft');
  mutateComments(id, (s) => resolveThread(s, tid));
  assert.equal(readMeta(id).status, 'draft', 'still the human\'s call');
});

test('a reply that leaves the thread open keeps the spec in draft', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  const tid = comment(id);
  setStatus(id, 'approved'); // approved over an open thread (only the CLI allows this)
  mutateComments(id, (s) => addComment(s, tid, { body: 'looking', author: 'claude', kind: 'agent' }));
  assert.equal(readMeta(id).status, 'draft', 'the next write to the thread corrects it');
});

test('a draft with an unresolved comment is left alone', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  comment(id);
  assert.equal(readMeta(id).status, 'draft');
});

test('an approved spec whose threads are all resolved stays approved', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  const tid = comment(id);
  mutateComments(id, (s) => resolveThread(s, tid));
  setStatus(id, 'approved');
  // A further no-op mutation must not knock it back down.
  mutateComments(id, (s) => resolveThread(s, tid));
  assert.equal(readMeta(id).status, 'approved');
});

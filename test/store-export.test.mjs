// Unit tests for the Google-Docs export relay model (lib/store-export.mjs). The
// export request rides on meta.export as a one-shot signal — set by the browser
// route, surfaced+advanced by the session hooks, finished by the CLI the skill
// calls — mirroring the implement signal.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import {
  requestExport, exportRequestsForSession, markExportWorking, finishExport, exportReason,
} from '../lib/store-export.mjs';

let home;
let prevHome;
let id;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-export-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  id = createSpec({ title: 'A spec', html: '<h1>A</h1>' });
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('requestExport stamps a one-shot requested signal on meta', () => {
  const ex = requestExport(id);
  assert.equal(ex.state, 'requested');
  assert.ok(ex.requestedAt, 'carries a timestamp');
  assert.equal(readMeta(id).export.state, 'requested');
});

test('requestExport throws for an unknown spec', () => {
  assert.throws(() => requestExport('nope'), /unknown spec/);
});

test('exportRequestsForSession returns only requested specs the session owns', () => {
  assert.deepEqual(exportRequestsForSession('s1'), [], 'nothing requested yet');
  attach(id, 's1');
  requestExport(id);
  const reqs = exportRequestsForSession('s1');
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].id, id);
  assert.deepEqual(exportRequestsForSession('other-session'), [], 'scoped to the owning session');
});

test('markExportWorking advances requested → working, once', () => {
  requestExport(id);
  assert.equal(markExportWorking(id), true);
  assert.equal(readMeta(id).export.state, 'working');
  assert.equal(markExportWorking(id), false, 'no-op once it has left requested');
});

test('a working export is no longer surfaced to the session', () => {
  attach(id, 's1');
  requestExport(id);
  markExportWorking(id);
  assert.deepEqual(exportRequestsForSession('s1'), [], 'surfaced once, then quiet');
});

test('finishExport records the Doc url (done) or the error', () => {
  requestExport(id);
  const done = finishExport(id, { url: 'https://docs.google.com/document/d/abc/edit' });
  assert.equal(done.state, 'done');
  assert.equal(done.url, 'https://docs.google.com/document/d/abc/edit');
  assert.ok(done.at);

  requestExport(id);
  const errored = finishExport(id, { error: 'drive auth failed' });
  assert.equal(errored.state, 'error');
  assert.equal(errored.error, 'drive auth failed');
});

test('finishExport requires a url or an error (no "undefined" url)', () => {
  requestExport(id);
  assert.throws(() => finishExport(id, {}), /url or error/);
});

test('exportReason names the specs and points at the export skill', () => {
  const reason = exportReason([{ id, title: 'A spec' }]);
  assert.match(reason, /A spec/);
  assert.match(reason, /specforge:export/);
  assert.match(reason, /export-done/);
});

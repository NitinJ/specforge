import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import {
  cmdCreate, cmdImport, cmdOpen, cmdStart, cmdList, cmdListall, cmdDetach,
} from '../lib/specforge-cli.mjs';

let home;
let prevHome;

const deps = (session = 'sess-1') => ({
  session,
  ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/', port: 4180 }),
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-cli-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('create scaffolds a store spec, attaches it, returns its url', async () => {
  const r = await cmdCreate({ title: 'My Spec' }, deps());
  assert.ok(r.id);
  assert.equal(r.status, 'draft');
  assert.match(r.url, new RegExp(`/spec/${r.id}$`));
  assert.ok(existsSync(r.htmlPath));
  const meta = readMeta(r.id);
  assert.equal(meta.title, 'My Spec');
  assert.equal(meta.attachedSession, 'sess-1');
});

test('create without a session scaffolds unattached (graceful degrade)', async () => {
  const r = await cmdCreate({ title: 'No Session' }, deps(''));
  assert.equal(readMeta(r.id).attachedSession, null);
});

test('import ingests an existing .html spec and records its origin', async () => {
  const src = join(home, 'design.html');
  writeFileSync(src, '<!doctype html><title>t</title><h1>Imported</h1><p>body</p>');
  const r = await cmdImport({ file: src }, deps());
  assert.equal(readFileSync(r.htmlPath, 'utf8'), readFileSync(src, 'utf8'));
  const meta = readMeta(r.id);
  assert.equal(meta.title, 'Imported');
  assert.equal(meta.origin, src);
  assert.equal(meta.attachedSession, 'sess-1');
});

test('open attaches a spec to this session and returns its url', async () => {
  const created = await cmdCreate({ title: 'A' }, deps('sess-1'));
  await cmdDetach({ id: created.id }, deps());
  const r = await cmdOpen({ id: created.id }, deps('sess-2'));
  assert.match(r.url, new RegExp(`/spec/${created.id}$`));
  assert.equal(readMeta(created.id).attachedSession, 'sess-2');
});

test('open fails when another live session holds the spec', async () => {
  const created = await cmdCreate({ title: 'A' }, deps('sess-1'));
  await assert.rejects(() => cmdOpen({ id: created.id }, deps('sess-2')), /another session/);
});

test('open rejects an unknown spec', async () => {
  await assert.rejects(() => cmdOpen({ id: 'deadbeef00' }, deps()), /unknown spec/);
});

test('list shows only this session’s specs', async () => {
  const a = await cmdCreate({ title: 'A' }, deps('sess-1'));
  const b = await cmdCreate({ title: 'B' }, deps('sess-1'));
  await cmdCreate({ title: 'C' }, deps('sess-2'));
  const { rows } = await cmdList({}, deps('sess-1'));
  assert.deepEqual(rows.map((r) => r.id).sort(), [a.id, b.id].sort());
});

test('start ensures the daemon and returns the index url', async () => {
  const { url } = await cmdStart({}, deps());
  assert.equal(url, 'http://127.0.0.1:4180/');
});

test('listall shows every spec with its attached state', async () => {
  const a = await cmdCreate({ title: 'A' }, deps('sess-1'));
  await cmdDetach({ id: a.id }, deps());
  await cmdCreate({ title: 'B' }, deps('sess-2'));
  const { rows, indexUrl, session } = await cmdListall({}, deps());
  assert.equal(rows.length, 2);
  assert.equal(indexUrl, 'http://127.0.0.1:4180/');
  assert.equal(session, 'sess-1', 'listall reports the current session so the picker can classify rows');
  const free = rows.find((r) => r.id === a.id);
  assert.equal(free.attached, 'free');
  assert.ok(rows.some((r) => r.attached === 'sess-2'));
});

test('detach rejects an unknown spec', async () => {
  await assert.rejects(() => cmdDetach({ id: 'deadbeef00' }, deps()), /unknown spec/);
});

test('detach frees a spec and drops it from the session list', async () => {
  const a = await cmdCreate({ title: 'A' }, deps('sess-1'));
  const res = await cmdDetach({ id: a.id }, deps());
  assert.deepEqual(res, { ok: true, id: a.id });
  assert.equal(readMeta(a.id).attachedSession, null);
  const { rows } = await cmdList({}, deps('sess-1'));
  assert.equal(rows.length, 0);
});

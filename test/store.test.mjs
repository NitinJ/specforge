import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  newSpecId, createSpec, readSpecHtml, writeSpecHtml, listSpecIds,
  extractTitle, specHtmlPath, metaPath, specsDir, storeRoot,
} from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-store-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('SPECFORGE_HOME is honoured at call time, not import time', () => {
  assert.equal(storeRoot(), home);
  assert.equal(specsDir(), join(home, 'specs'));
});

test('newSpecId is a 10-char hex id and is unique', () => {
  const a = newSpecId();
  assert.match(a, /^[0-9a-f]{10}$/);
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(newSpecId());
  assert.equal(ids.size, 200);
});

test('createSpec writes spec.html + meta.json and round-trips HTML', () => {
  const html = '<!doctype html><title>X</title><h1>Gateway billing</h1>';
  const id = createSpec({ title: null, origin: '/home/nitin/proj', html });

  assert.ok(existsSync(specHtmlPath(id)));
  assert.ok(existsSync(metaPath(id)));
  assert.equal(readSpecHtml(id), html);

  const meta = readMeta(id);
  assert.equal(meta.id, id);
  assert.equal(meta.title, 'Gateway billing'); // extracted from <h1>
  assert.equal(meta.status, 'draft');
  assert.equal(meta.origin, '/home/nitin/proj');
  assert.equal(meta.attachedSession, null);
  assert.equal(meta.heartbeat, 0);
});

test('createSpec honours an explicit title over the HTML', () => {
  const id = createSpec({ title: 'Explicit', html: '<h1>From HTML</h1>' });
  assert.equal(readMeta(id).title, 'Explicit');
});

test('createSpec stores the spec type (default design-impl, honours explicit)', () => {
  assert.equal(readMeta(createSpec({ html: '<h1>A</h1>' })).type, 'design-impl');
  assert.equal(readMeta(createSpec({ html: '<h1>B</h1>', type: 'research' })).type, 'research');
});

test('writeSpecHtml overwrites an existing spec', () => {
  const id = createSpec({ html: '<h1>v1</h1>' });
  writeSpecHtml(id, '<h1>v2</h1>');
  assert.equal(readSpecHtml(id), '<h1>v2</h1>');
});

test('listSpecIds lists created specs only', () => {
  assert.deepEqual(listSpecIds(), []);
  const a = createSpec({ html: '<h1>A</h1>' });
  const b = createSpec({ html: '<h1>B</h1>' });
  assert.deepEqual(listSpecIds().sort(), [a, b].sort());
});

test('extractTitle prefers h1 > title > Untitled', () => {
  assert.equal(extractTitle('<h1>Heading</h1><title>Doc</title>'), 'Heading');
  assert.equal(extractTitle('<title>Doc — Spec</title>'), 'Doc');
  assert.equal(extractTitle('<p>no headings here</p>'), 'Untitled');
  // tags inside the h1 are stripped
  assert.equal(extractTitle('<h1>Hello <em>there</em></h1>'), 'Hello there');
  // empty h1 falls through to title
  assert.equal(extractTitle('<h1></h1><title>Fallback</title>'), 'Fallback');
});

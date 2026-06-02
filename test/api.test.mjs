import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApp } from '../server/app.mjs';
import { buildIndex } from '../lib/paths.mjs';
import { storePath } from '../lib/comments.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const anchor = { sectionId: 'overview', quote: { exact: 'The problem' } };

function specsDirWith() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-api-'));
  writeFileSync(join(dir, 's-spec.html'), TEMPLATE.replace('{{TITLE}}', 'API Spec'));
  return { dir, id: buildIndex(dir)[0].id };
}
async function withServer(specsDir, fn) {
  const server = createApp({ specsDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const postJSON = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('comments API: create → persist → get with resolution', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    const created = await postJSON(base, `/api/spec/${id}/comments`, { anchor, body: 'why?' });
    assert.equal(created.status, 201);

    assert.ok(existsSync(storePath(dir, id)), 'store file written under .specforge/<id>/');

    const get = await fetch(`${base}/api/spec/${id}/comments`);
    assert.equal(get.status, 200);
    const data = await get.json();
    assert.equal(data.threads.length, 1);
    assert.equal(data.threads[0].comments[0].body, 'why?');
    assert.equal(data.threads[0].resolution.status, 'precise');
  });
});

test('comments API: reply (claude) flips to replied; resolve sets resolved', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    const created = await postJSON(base, `/api/spec/${id}/comments`, { anchor, body: 'q' });
    const tid = (await created.json()).thread.id;

    const reply = await postJSON(base, `/api/spec/${id}/comments/${tid}/reply`, { body: 'a', author: 'claude' });
    assert.equal(reply.status, 201);
    let data = await (await fetch(`${base}/api/spec/${id}/comments`)).json();
    assert.equal(data.threads[0].state, 'replied');

    const res = await postJSON(base, `/api/spec/${id}/comments/${tid}/resolve`, {});
    assert.equal(res.status, 200);
    data = await (await fetch(`${base}/api/spec/${id}/comments`)).json();
    assert.equal(data.threads[0].state, 'resolved');
  });
});

test('comments API: invalid create is rejected 400', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    const r = await postJSON(base, `/api/spec/${id}/comments`, { body: 'no anchor' });
    assert.equal(r.status, 400);
  });
});

test('static: review assets serve; traversal blocked', async () => {
  const { dir } = specsDirWith();
  await withServer(dir, async (base) => {
    const js = await fetch(`${base}/public/review.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const css = await fetch(`${base}/public/review.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /css/);
    const bad = await fetch(`${base}/public/nope.txt`);
    assert.equal(bad.status, 404);
  });
});

test('serve injects the review UI assets', async () => {
  const { dir, id } = specsDirWith();
  await withServer(dir, async (base) => {
    const body = await (await fetch(`${base}/spec/${id}`)).text();
    assert.match(body, /\/public\/review\.css/);
    assert.match(body, /\/public\/review\.js/);
    assert.match(body, /window\.SPECFORGE/);
  });
});

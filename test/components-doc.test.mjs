// The library document: a new store primitive, served at /components.
//
// Resolves design Q1. It is not a template spec and not a page in the repo: it
// is generated from the component definitions, served with the review layer
// attached so it is commentable, and edited through the batch loop that already
// exists. A human comments on a component, the agent edits the definition, the
// build regenerates, the browser reloads.
//
// The boundary matters as much as the document. It is not a spec: no lifecycle,
// no sections contract, and it does not appear in the index's spec list or its
// counts.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specHtmlPath, isReservedId } from '../lib/store-paths.mjs';
import { specUrl } from '../lib/daemon-client.mjs';
import { syncAll } from '../lib/components-stamp.mjs';
import { COMPONENTS, FAMILIES, LAYERS, componentsIn } from '../components/index.mjs';
import { buildDoc, docPath, writeDoc, DOC_ID } from '../lib/components-doc.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-doc-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

// ---- the document ----

test('each document carries a specimen and a rule for every component in its layer', () => {
  // Per layer, not per registry: a component is documented in exactly one of the
  // two collections, and asking the static document for an interactive one would
  // be asking it to list something it does not carry.
  for (const layer of LAYERS) {
    const html = buildDoc({ layer });
    const items = componentsIn(layer);
    for (const c of items) {
      assert.ok(html.includes(`data-component="${c.name}"`), `${c.name} has an entry in ${layer}`);
      assert.ok(html.includes(c.rule), `${c.name} shows its rule`);
    }
    const entries = (html.match(/data-component="/g) || []).length;
    assert.equal(entries, items.length, `one entry per ${layer} component and no more`);
  }
});

test('the document groups by family, in the library order', () => {
  const html = buildDoc();
  const seen = FAMILIES.filter((f) => html.includes(`data-family="${f}"`));
  assert.deepEqual(seen, FAMILIES, 'every family, in order');
});

test('the document carries the stamped stylesheet, so its specimens render', () => {
  const html = buildDoc();
  assert.match(html, /specforge:components v\d+ start/);
  assert.match(html, /\.callout\.decision::before/, 'the real rules, not a copy');
});

test('the document is generated: building twice is byte-identical', () => {
  assert.equal(buildDoc(), buildDoc());
});

test('writeDoc puts it in the store under the reserved id', () => {
  // writeDoc writes every layer's document and reports on each, so this asks for
  // the static one by id rather than assuming it is the only one.
  const written = writeDoc();
  assert.ok(written.some((r) => r.id === DOC_ID), 'the static document was written');
  assert.ok(existsSync(docPath()), 'the file exists');
  assert.equal(readFileSync(docPath(), 'utf8'), buildDoc());
});

// A generated document that a person edited is a document that loses the edit at
// the next build, so build always overwrites and never merges.
test('writeDoc recreates the document after it is deleted', () => {
  writeDoc();
  rmSync(docPath());
  assert.equal(existsSync(docPath()), false);
  writeDoc();
  assert.ok(existsSync(docPath()), 'build recreates it');
});

// ---- addressable as a store entry ----

// The whole reason it lives in the store: every comments handler starts with
// readMeta(id) and 404s without it, so a document with no meta.json renders a
// review layer whose every write is refused.
test('writeDoc gives it a meta.json, so the comments API can resolve it', () => {
  writeDoc();
  const meta = readMeta(DOC_ID);
  assert.ok(meta, 'the entry resolves');
  assert.equal(meta.id, DOC_ID);
  assert.equal(meta.reserved, true, 'and says what it is');
});

// The live-reload watcher takes an id, not a path, and watches
// specs/<id>/spec.html. A document written anywhere else reloads on nothing.
test('the document is at the path the review layer resolves for its id', () => {
  assert.equal(docPath(), specHtmlPath(DOC_ID));
});

test('a rebuild leaves the meta alone', () => {
  writeDoc();
  const meta = readMeta(DOC_ID);
  meta.attachedSession = 's-1';
  meta.status = 'approved';
  writeFileSync(join(home, 'specs', DOC_ID, 'meta.json'), JSON.stringify(meta));
  writeDoc();
  const after = readMeta(DOC_ID);
  assert.equal(after.attachedSession, 's-1', 'the session that owns it survives');
  assert.equal(after.status, 'approved', 'and so does the human judgement on it');
});

// It carries the attribute, so without the reserved-id skip `sync --all` would
// report the generated document as a spec it stamped.
test('components sync --all skips it', () => {
  writeDoc();
  const r = syncAll();
  const seen = [...r.synced, ...r.unchanged, ...r.skipped, ...r.refused.map((x) => x.id)];
  assert.ok(!seen.includes(DOC_ID), 'not stamped, not skipped, not reported');
});

// ---- served ----

test('GET /components serves the document with the review layer', async (t) => {
  writeDoc();
  const server = createDaemon();
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));

  const res = await fetch(`http://127.0.0.1:${port}/components`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /specforge:review-layer/, 'commentable, like a spec');
  assert.match(body, /data-component="deviation"/, 'and it is the document');
});

test('GET /components builds it on demand when the store has none', async (t) => {
  const server = createDaemon();
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));

  assert.equal(existsSync(docPath()), false, 'nothing in the store yet');
  const res = await fetch(`http://127.0.0.1:${port}/components`);
  assert.equal(res.status, 200, 'served anyway');
  assert.match(await res.text(), /data-component="risk"/);
});

// The review layer on the page is worth nothing if the API behind it refuses.
// This is the assertion the first draft of this stage was missing: it checked
// that the layer was injected, not that a comment written through it lands.
test('a comment written on the document is stored and read back', async (t) => {
  writeDoc();
  const server = createDaemon();
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));

  const api = `http://127.0.0.1:${port}/api/spec/${DOC_ID}/comments`;
  const post = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anchor: { block: { index: 3, tag: 'div', text: 'A decision that has been made.' } },
      body: 'Should this one be a constraint instead?',
      author: 'Nitin',
    }),
  });
  assert.equal(post.status, 201, 'the write is accepted');

  const got = await (await fetch(api)).json();
  assert.equal(got.threads.length, 1);
  assert.equal(got.threads[0].comments[0].body, 'Should this one be a constraint instead?');
  assert.equal(got.threads[0].comments[0].author, 'Nitin');
});

// The build writes to disk. Thrown from the request handler that unhandled
// rejection takes the daemon down, and with it every other spec open in a
// browser, over a page nobody was reading.
test('a store it cannot write to is a 500, not a dead daemon', async (t) => {
  const server = createDaemon();
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));

  const blocked = join(home, 'not-a-directory');
  writeFileSync(blocked, 'a file where the store root should be');
  process.env.SPECFORGE_HOME = blocked;
  t.after(() => { process.env.SPECFORGE_HOME = home; });

  const res = await fetch(`http://127.0.0.1:${port}/components`);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /could not build the component library/);

  process.env.SPECFORGE_HOME = home;
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200, 'still serving');
});

// ---- the boundary: it is not a spec ----

test('the document id is reserved, so nothing lists it as a spec', () => {
  assert.equal(isReservedId(DOC_ID), true);
});

// `open <id>` is what the header's Connect button tells a human to run, and it
// prints the url it attached. Composing /spec/<id> for a reserved id would hand
// back the one route that 404s.
test('the url for the reserved id is its own route', () => {
  assert.equal(specUrl('http://127.0.0.1:4180/', DOC_ID), 'http://127.0.0.1:4180/components');
  assert.equal(specUrl('http://127.0.0.1:4180/', 'abc123'), 'http://127.0.0.1:4180/spec/abc123');
});

// The document is born unattached and nothing attaches it, so a reviewer who
// comments and waits is waiting on nobody. The page has to say so.
test('the document says how to get an agent onto it', () => {
  assert.match(buildDoc(), /specforge open specforge-components/);
});

test('the document does not appear in the index spec list or its counts', async () => {
  createSpec({ title: 'A real spec', html: '<h1>A</h1>' });
  writeDoc();
  const html = renderIndex();
  assert.match(html, /A real spec/, 'the real spec is listed');
  assert.ok(!html.includes(`/spec/${DOC_ID}`), 'the document is not listed as a spec');
  assert.match(html, /1 spec\b/, 'and is not counted as one');
});

test('the reserved id is not servable as a spec', async (t) => {
  writeDoc();
  const server = createDaemon();
  const port = await listen(server);
  t.after(() => new Promise((r) => server.close(r)));

  const res = await fetch(`http://127.0.0.1:${port}/spec/${DOC_ID}`);
  assert.equal(res.status, 404, 'it is reached at /components or not at all');
});

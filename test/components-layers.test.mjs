// Two collections from one registry.
//
// Interactive components need everything a static one gets: the stamped
// stylesheet, the lint registry, the commentability allow-list, the rules file
// and a document. The obvious way to give them that is a second definitions
// directory with a second builder, and it is the wrong way: two builders emitting
// into one stamped block is exactly how six independent copies of the table rules
// accumulated across five shells and the library page (removed in 28b2a06, which
// also found that one of them had silently disabled the whole heading family).
//
// So the registry stays single and grows a `layer` field. These tests pin the
// three properties that makes safe: the split is total, the split is disjoint,
// and adding it changed nothing about the collection that already existed.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { specUrl } from '../lib/daemon-client.mjs';
import { isReservedId, RESERVED_IDS, reservedRoute } from '../lib/store-paths.mjs';
import { COMPONENTS, LAYERS, componentsIn, layerOf } from '../components/index.mjs';
import { buildBody } from '../lib/components-build.mjs';
import {
  buildDoc, docPath, writeDoc, DOC_ID, INTERACTIVE_DOC_ID, docIdFor,
} from '../lib/components-doc.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-layers-'));
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

// ---- the split ----

test('there are exactly two layers', () => {
  assert.deepEqual(LAYERS, ['static', 'interactive']);
});

test('a component that declares no layer is static', () => {
  // The default is what keeps this change invisible to the 39 that came before
  // it. Asserted on a bare object rather than on the registry so it still holds
  // once every real component has been given an explicit layer.
  assert.equal(layerOf({ name: 'x', family: 'data' }), 'static');
  assert.equal(layerOf({ name: 'x', family: 'data', layer: 'interactive' }), 'interactive');
});

test('every component resolves to a declared layer', () => {
  for (const c of COMPONENTS) {
    assert.ok(LAYERS.includes(layerOf(c)), `${c.name} has layer ${layerOf(c)}`);
  }
});

test('the split is total and disjoint', () => {
  // Total: a component in neither document is a component an agent cannot find.
  // Disjoint: one in both is one that gets two rules and eventually two answers.
  const stat = componentsIn('static').map((c) => c.name);
  const live = componentsIn('interactive').map((c) => c.name);
  assert.equal(stat.length + live.length, COMPONENTS.length, 'nothing falls between them');
  assert.deepEqual(stat.filter((n) => live.includes(n)), [], 'and nothing is in both');
});

test('the stamped stylesheet carries both layers', () => {
  // Interactive components are stamped CSS plus a served script, never script
  // alone. A stylesheet that skipped them would leave their markup unstyled in
  // exactly the case the whole design exists to protect: no script.
  const css = buildBody();
  for (const c of COMPONENTS) {
    if (!c.css) continue;
    const first = c.css.split('{')[0].trim();
    assert.ok(css.includes(first), `${c.name} (${layerOf(c)}) is in the stamped block`);
  }
});

// ---- two documents ----

test('each layer has its own reserved id and route', () => {
  assert.equal(docIdFor('static'), DOC_ID);
  assert.equal(docIdFor('interactive'), INTERACTIVE_DOC_ID);
  assert.notEqual(DOC_ID, INTERACTIVE_DOC_ID);
  for (const id of [DOC_ID, INTERACTIVE_DOC_ID]) {
    assert.ok(RESERVED_IDS.has(id), `${id} is reserved`);
    assert.ok(isReservedId(id), `${id} reads as reserved`);
  }
  assert.equal(reservedRoute(DOC_ID), '/components');
  assert.equal(reservedRoute(INTERACTIVE_DOC_ID), '/components-interactive');
});

test('a document holds its own layer and nothing from the other', () => {
  const stat = buildDoc({ layer: 'static' });
  const live = buildDoc({ layer: 'interactive' });
  for (const c of componentsIn('static')) {
    assert.ok(stat.includes(`data-component="${c.name}"`), `${c.name} is in the static document`);
    assert.ok(!live.includes(`data-component="${c.name}"`), `${c.name} is not in the other`);
  }
  for (const c of componentsIn('interactive')) {
    assert.ok(live.includes(`data-component="${c.name}"`), `${c.name} is in the interactive document`);
    assert.ok(!stat.includes(`data-component="${c.name}"`), `${c.name} is not in the other`);
  }
});

test('buildDoc defaults to the static layer, as every existing caller expects', () => {
  assert.equal(buildDoc(), buildDoc({ layer: 'static' }));
});

test('an empty collection says so rather than rendering a bare page', () => {
  // True on the day this lands and false the day after. It is here because an
  // empty document that looks like a broken one is the failure a reader reports,
  // and the emptiness is a fact about the registry, not about the builder.
  const live = buildDoc({ layer: 'interactive' });
  if (componentsIn('interactive').length === 0) {
    assert.match(live, /no interactive components yet/i);
  } else {
    assert.ok(!/no interactive components yet/i.test(live), 'and stops saying so once there are');
  }
});

test('both documents are generated: building twice is byte-identical', () => {
  for (const layer of LAYERS) {
    assert.equal(buildDoc({ layer }), buildDoc({ layer }), `${layer} is deterministic`);
  }
});

test('writeDoc writes both, each under its own id', () => {
  const written = writeDoc();
  assert.deepEqual(written.map((r) => r.id).sort(), [DOC_ID, INTERACTIVE_DOC_ID].sort());
  for (const layer of LAYERS) {
    const id = docIdFor(layer);
    assert.ok(existsSync(docPath(id)), `${id} exists on disk`);
    assert.equal(readFileSync(docPath(id), 'utf8'), buildDoc({ layer }));
  }
});

// ---- served ----

test('each document is served at its own route and nowhere else', async () => {
  const srv = createDaemon();
  const port = await listen(srv);
  try {
    for (const [id, route] of [[DOC_ID, '/components'], [INTERACTIVE_DOC_ID, '/components-interactive']]) {
      const ok = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(ok.status, 200, `${route} serves`);
      const html = await ok.text();
      assert.match(html, /specforge:review-layer/, `${route} is commentable`);

      const denied = await fetch(`http://127.0.0.1:${port}/spec/${id}`);
      assert.equal(denied.status, 404, `/spec/${id} stays a 404`);
    }
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('the two routes serve different documents', async () => {
  const srv = createDaemon();
  const port = await listen(srv);
  try {
    const a = await (await fetch(`http://127.0.0.1:${port}/components`)).text();
    const b = await (await fetch(`http://127.0.0.1:${port}/components-interactive`)).text();
    assert.notEqual(a, b);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('specUrl sends each reserved id to its own route', () => {
  const base = 'http://127.0.0.1:4180/';
  assert.equal(specUrl(base, DOC_ID), 'http://127.0.0.1:4180/components');
  assert.equal(specUrl(base, INTERACTIVE_DOC_ID), 'http://127.0.0.1:4180/components-interactive');
  assert.equal(specUrl(base, 'abc123'), 'http://127.0.0.1:4180/spec/abc123');
});

test('neither document appears in the index', async () => {
  writeDoc();
  const html = await renderIndex();
  for (const id of [DOC_ID, INTERACTIVE_DOC_ID]) {
    assert.ok(!html.includes(`/spec/${id}`), `${id} is not listed as a spec`);
  }
});

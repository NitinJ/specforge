// html → md → html', over the whole corpus.
//
// This is the suite the feature is judged against. The exporter and the importer
// can each be internally consistent and still lose a document between them; only
// running the cycle proves they agree.
//
// Equivalence is structural, never byte-for-byte: whitespace, attribute order,
// inline styles and tag classes are documented losses. What must survive is in
// test/helpers/structural-equivalence.mjs.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { FIXTURES, fixture } from './fixtures/md/index.mjs';
import { assertStructurallyEquivalent } from './helpers/structural-equivalence.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { specToMarkdown } from '../lib/html-to-md.mjs';
import { markdownToSpecHtml } from '../lib/md-to-html.mjs';
import { exportMd, importMd } from '../lib/store-md.mjs';
import { createSpec, readSpecHtml } from '../lib/store.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');

/** Export a fixture and import it back, resolving assets from what the export produced. */
function cycle(html, type = 'design') {
  const exported = specToMarkdown(html, { id: 'abc1234567', type, exportedAt: '2026-08-14' });
  const byName = new Map(exported.assets.map((a) => [a.name, a.svg]));
  const imported = markdownToSpecHtml(exported.markdown, {
    shell: SHELL,
    date: '2026-08-14',
    owner: 'nitin',
    resolveAsset: (src) => {
      const base = src.split('/').pop();
      return byName.has(base) ? { kind: 'svg', text: byName.get(base) } : { kind: 'missing' };
    },
  });
  return { exported, imported };
}

test('every fixture survives a round trip structurally intact', () => {
  for (const f of FIXTURES) {
    const before = f.html();
    const { imported } = cycle(before, f.type);
    assertStructurallyEquivalent(imported.html, before, f.name);
  }
});

test('every round-tripped spec passes the lint', () => {
  for (const f of FIXTURES) {
    const { imported } = cycle(f.html(), f.type);
    const { ok, checks } = lintSpec(imported.html);
    const failing = checks.filter((c) => !c.ok && !c.advisory).map((c) => c.name);
    assert.ok(ok, `${f.name}: ${failing.join(', ')}`);
  }
});

test('a round trip reports nothing unreadable and drops no asset', () => {
  for (const f of FIXTURES) {
    const { imported } = cycle(f.html(), f.type);
    assert.deepEqual(imported.report.unsupported, [], `${f.name} parsed whole`);
    assert.deepEqual(imported.report.assetsDropped, [], `${f.name} kept its diagrams`);
  }
});

test('a second cycle changes nothing: the conversion is a fixed point', () => {
  for (const f of FIXTURES) {
    const once = cycle(f.html(), f.type);
    const twice = cycle(once.imported.html, f.type);
    // The markdown, not just the HTML: drift would show up here first, and this
    // is what makes exporting an imported document safe to do repeatedly.
    assert.equal(twice.exported.markdown, once.exported.markdown, `${f.name} is stable across cycles`);
    assertStructurallyEquivalent(twice.imported.html, once.imported.html, `${f.name} second cycle`);
  }
});

test('the plan survives with every task id and status', () => {
  const { imported } = cycle(fixture('design-impl').html(), 'design-impl');
  assert.match(imported.html, /data-sf-task="1\.2" data-sf-status="in_progress"/);
  assert.match(imported.html, /data-sf-task="1\.3" data-sf-status="blocked"/);
  assert.match(imported.html, /data-sf-task="1\.4" data-sf-status="deferred"/);
  assert.match(imported.html, /data-sf-stage="0" data-sf-pr="311"/);
});

test('diagrams come back inline, and nothing points outside the file', () => {
  const { imported } = cycle(fixture('diagrams').html(), 'design');
  assert.equal((imported.html.match(/<svg\b/g) || []).length, 2);
  assert.doesNotMatch(imported.html, /\.assets\//, 'no link left pointing at the export directory');
  assert.match(imported.html, /aria-label="Collector feeds the queue, the queue feeds the writer"/);
});

// ---------------------------------------------------------------- on disk

const store = useTempStore({ beforeEach, afterEach }, 'sf-mdround-');

test('the whole trip through the CLI layer: export to disk, import back', () => {
  ensureTemplates();
  const original = createSpec({ html: fixture('diagrams').html(), title: 'Topology', type: 'design' });

  const out = exportMd(original, { out: store.dir, exportedAt: '2026-08-14' });
  assert.equal(out.assets, 2);
  assert.deepEqual(readdirSync(out.assetsDir).sort(), ['architecture-1.svg', 'flow-1.svg']);

  const back = importMd(out.mdPath);
  assert.notEqual(back.id, original, 'import creates a new spec, it never writes over the source');
  assert.equal(back.report.lint, 'PASS');
  assert.deepEqual(back.report.assetsDropped, [], 'the sidecar files were found and inlined');
  assert.equal(back.report.derivedFrom, original, 'provenance is recorded from the frontmatter');

  assertStructurallyEquivalent(readSpecHtml(back.id), readSpecHtml(original), 'disk round trip');
});

test('the original spec is untouched by importing its own export', () => {
  ensureTemplates();
  const original = createSpec({ html: fixture('design').html(), title: 'Retry policy', type: 'design' });
  const before = readSpecHtml(original);

  const out = exportMd(original, { out: store.dir, exportedAt: '2026-08-14' });
  importMd(out.mdPath);

  assert.equal(readSpecHtml(original), before, 'byte for byte, the source spec did not move');
});

test('an export moved away from its assets imports with the loss reported', () => {
  ensureTemplates();
  const id = createSpec({ html: fixture('diagrams').html(), title: 'Topology', type: 'design' });
  const out = exportMd(id, { out: join(store.dir, 'here'), exportedAt: '2026-08-14' });

  // The .md alone, with its assets directory left behind: a real thing people do.
  const orphan = join(store.dir, 'moved.md');
  writeFileSync(orphan, readFileSync(out.mdPath, 'utf8'));

  const back = importMd(orphan);
  assert.equal(back.report.assetsDropped.length, 2, 'both diagrams are named as missing');
  assert.equal(back.report.lint, 'PASS', 'the spec is still valid without them');
});

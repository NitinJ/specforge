import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  sections, buildIndex, map, section, grep, search, around, neighbors, xrefs,
} from '../lib/spec-nav.mjs';
import { buildIndex as buildPathIndex } from '../lib/paths.mjs';
import { writeIndex, loadIndex, indexPath } from '../lib/spec-nav-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'spec-nav-cli.mjs');

// A small fixture spec: overview links to auth; the plan has one stage.
const FIXTURE = `<!doctype html><html data-sf-spec-status="draft"><head><title>Fixture — Spec</title></head><body>
<main>
  <section id="overview" data-sf-section>
    <h2>1 · Overview</h2>
    <p>This spec covers the login system. See the <a href="#auth">auth section</a> for details.</p>
  </section>
  <section id="auth" data-sf-section>
    <h2>2 · Authentication</h2>
    <p>The login endpoint verifies a token and issues a session cookie.</p>
  </section>
  <section id="billing" data-sf-section>
    <h2>3 · Billing</h2>
    <p>Credits are deducted per request before charging the customer.</p>
  </section>
  <section id="impl-plan" data-sf-section>
    <h2>6 · Implementation plan</h2>
    <ol class="sf-stages">
      <li data-sf-stage="1" data-sf-pr="#7">
        <ul class="sf-tasks">
          <li data-sf-task="1.1" data-sf-status="done">Build auth.</li>
          <li data-sf-task="1.2" data-sf-status="todo">Build billing.</li>
        </ul>
      </li>
    </ol>
  </section>
</main></body></html>`;

test('sections: splits into units with char + line spans and heading/level', () => {
  const units = sections(FIXTURE);
  assert.deepEqual(units.map((u) => u.id), ['overview', 'auth', 'billing', 'impl-plan']);
  const auth = units.find((u) => u.id === 'auth');
  assert.equal(auth.header, '2 · Authentication');
  assert.equal(auth.level, 2);
  assert.ok(auth.charStart < auth.charEnd);
  assert.ok(auth.lineStart >= 1 && auth.lineEnd >= auth.lineStart);
  assert.match(auth.text, /session cookie/);
});

test('buildIndex: docMap order + plan + per-section descriptors', () => {
  const idx = buildIndex(FIXTURE);
  assert.deepEqual(idx.docMap.order, ['overview', 'auth', 'billing', 'impl-plan']);
  assert.equal(idx.docMap.plan[0].stage, '1');
  assert.equal(idx.docMap.plan[0].pr, '#7');
  assert.equal(idx.docMap.plan[0].tasks[0].status, 'done');

  const overview = idx.sections.find((s) => s.id === 'overview');
  assert.deepEqual(overview.neighborIds, ['auth']); // first section: only next
  assert.deepEqual(overview.refsTo, ['auth']); // href="#auth"
  assert.ok(overview.summary.length > 0);
  assert.ok(overview.tokenEst > 0);
  assert.ok(overview.keyTerms.length > 0);

  const auth = idx.sections.find((s) => s.id === 'auth');
  assert.deepEqual(auth.neighborIds, ['overview', 'billing']); // middle: prev + next
});

test('map: resident outline with order, plan and per-section glance fields', () => {
  const m = map(buildIndex(FIXTURE));
  assert.deepEqual(m.order, ['overview', 'auth', 'billing', 'impl-plan']);
  assert.equal(m.sections.length, 4);
  assert.equal(m.plan[0].stage, '1');
  for (const s of m.sections) {
    assert.ok('header' in s && 'tokenEst' in s && 'lineStart' in s && 'keyTerms' in s);
  }
});

test('section: returns body text from ground-truth HTML + descriptor', () => {
  const idx = buildIndex(FIXTURE);
  const s = section(idx, FIXTURE, 'auth');
  assert.equal(s.header, '2 · Authentication');
  assert.match(s.text, /verifies a token/);
  assert.deepEqual(s.neighborIds, ['overview', 'billing']);
  assert.equal(section(idx, FIXTURE, 'nope'), null);
});

test('grep: regex over section text → matching section + real line number', () => {
  const hits = grep(FIXTURE, 'session cookie');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'auth');
  assert.ok(hits[0].line >= 1);
  assert.match(hits[0].match, /session cookie/);
});

test('search: BM25-ranked sections with header, score, snippet, lines', () => {
  const idx = buildIndex(FIXTURE);
  const hits = search(idx, FIXTURE, 'login token cookie');
  assert.equal(hits[0].id, 'auth');
  assert.ok(hits[0].score > 0);
  assert.match(hits[0].snippet, /token|cookie/i);
  assert.ok(hits[0].lineStart >= 1);
});

test('around: context window by id, line number, and text — center marked', () => {
  const byId = around(FIXTURE, 'auth', 1);
  assert.ok(byId.lines.some((l) => l.mark));
  const byLine = around(FIXTURE, byId.center, 2);
  assert.equal(byLine.center, byId.center);
  const byText = around(FIXTURE, 'session cookie', 0);
  assert.match(byText.lines[0].text, /session cookie/);
  assert.equal(around(FIXTURE, 'zzz-nomatch'), null);
});

test('neighbors: prev/next siblings in document order', () => {
  const idx = buildIndex(FIXTURE);
  const n = neighbors(idx, 'auth');
  assert.equal(n.prev.id, 'overview');
  assert.equal(n.next.id, 'billing');
  assert.equal(neighbors(idx, 'overview').prev, null);
  assert.equal(neighbors(idx, 'nope'), null);
});

test('xrefs: outbound anchors + inbound (anchor links and term mentions)', () => {
  const idx = buildIndex(FIXTURE);
  const x = xrefs(idx, 'auth');
  // overview links to #auth → inbound via anchor
  const fromOverview = x.refsFrom.find((r) => r.id === 'overview');
  assert.ok(fromOverview, 'overview references auth');
  assert.equal(fromOverview.via, 'anchor');

  // auth has no outbound #anchors
  assert.deepEqual(x.refsTo, []);

  // overview's xrefs include an outbound ref to auth
  const ox = xrefs(idx, 'overview');
  assert.ok(ox.refsTo.some((r) => r.id === 'auth'));
});

test('persist: writeIndex emits idx.json under .specforge/idx and loadIndex round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nav-'));
  writeFileSync(join(dir, 'fix-spec.html'), FIXTURE);
  const spec = buildPathIndex(dir)[0];
  const p = writeIndex(dir, spec);
  assert.equal(p, indexPath(dir, spec.id));
  assert.ok(existsSync(p));
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(doc.specId, spec.id);
  assert.equal(doc.title, 'Fixture');
  assert.deepEqual(doc.docMap.order, ['overview', 'auth', 'billing', 'impl-plan']);

  const loaded = loadIndex(dir, spec);
  assert.deepEqual(loaded.docMap.order, doc.docMap.order);
});

test('persist: loadIndex regenerates when the spec is newer than the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nav-stale-'));
  const file = join(dir, 'fix-spec.html');
  writeFileSync(file, FIXTURE);
  const spec = buildPathIndex(dir)[0];
  writeIndex(dir, spec);

  // mutate the spec + bump its mtime past the index
  writeFileSync(file, FIXTURE.replace('id="billing"', 'id="payments"'));
  const future = (statSync(indexPath(dir, spec.id)).mtimeMs + 5000) / 1000;
  utimesSync(file, future, future);

  const loaded = loadIndex(dir, spec);
  assert.ok(loaded.docMap.order.includes('payments'), 'index regenerated from newer spec');
});

// --- CLI ---
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 8000 });

function fixtureProject() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nav-cli-'));
  const file = join(dir, 'fix-spec.html');
  writeFileSync(file, FIXTURE);
  return { dir, file };
}

test('CLI map: --spec resolves a standalone file and prints the outline', () => {
  const { file } = fixtureProject();
  const res = run('map', '--spec', file);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /overview/);
  assert.match(res.stdout, /plan: S1/);
});

test('CLI search --json: ranked hits as machine-readable JSON', () => {
  const { file } = fixtureProject();
  const res = run('search', 'login', 'token', '--spec', file, '--json');
  assert.equal(res.status, 0, res.stderr);
  const hits = JSON.parse(res.stdout);
  assert.equal(hits[0].id, 'auth');
});

test('CLI xrefs --json: inbound + outbound references', () => {
  const { file } = fixtureProject();
  const res = run('xrefs', 'auth', '--spec', file, '--json');
  assert.equal(res.status, 0, res.stderr);
  const x = JSON.parse(res.stdout);
  assert.ok(x.refsFrom.some((r) => r.id === 'overview'));
});

test('CLI: missing target without --spec or active marker exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nav-noactive-'));
  const res = run('map', '--project', dir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no active spec|--spec/);
});

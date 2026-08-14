// Migration: the codemod pass, the classifier, and the report.
//
// D5 says migration is never automatic, so nothing here runs unless a person
// asks for one spec by id. What it must guarantee when asked: a class with more
// than one meaning in the store is not renamed, a class nobody else uses is not
// touched at all, and the spec is left on one vocabulary rather than half on
// each.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { specHtmlPath, specDir } from '../lib/store-paths.mjs';
import { optedIn, readBlock } from '../lib/components-stamp.mjs';
import { checkComponents } from '../lib/components-lint.mjs';
import {
  RENAMES, codemod, ambiguousBlocks, classify, migrateSpec, reportPath, readReport,
} from '../lib/components-migrate.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-mig-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/**
 * A spec carrying the legacy vocabulary in the shapes it actually takes in the
 * store: the callout types as callout modifiers, and the same words again on
 * chips, cards and tables, where they mean something else.
 */
const LEGACY = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><title>Legacy</title>
<style>
  :root{--bg:#fff;--ink:#111;--panel:#fff;--panel2:#eee;--line:#ddd;--muted:#666;
    --accent:#25f;--green:#0a0;--amber:#b50;--red:#b11;--code:#eee;--shadow:none;--mono:monospace}
  .callout{padding:8px}
  .c-risk{border-left:3px solid var(--red)}
  .c-win{border-left:3px solid var(--green)}
  .c-key{border-left:3px solid var(--accent)}
  .chip{font-size:11px}
  .grid2{display:grid;grid-template-columns:1fr 1fr}
  .fig{margin:0}
  .bespoke{outline:1px dotted var(--line)}
</style>
</head>
<body>
<section id="s1" data-sf-section>
  <h2>One</h2>
  <div class="callout c-risk">The stamped block is hand-edited.</div>
  <div class="callout c-win">Every notice type survives export.</div>
  <div class="callout c-key">The port is the singleton.</div>
  <div class="callout asm">We believe 34 components cover what specs need.</div>
  <div class="callout caut">Watch the density rule.</div>
  <div class="callout dec">The port is the singleton, chosen instead of a lockfile.</div>
  <div class="callout hon">This number is unverified.</div>
  <div class="callout win">Every check passed.</div>
  <span class="tag ok">done</span>
  <div class="grid2"><div class="bespoke">A</div><div class="bespoke">B</div></div>
  <figure class="fig"><img src="x.png" alt=""><figcaption>A figure.</figcaption></figure>
  <span class="chip asm">asm</span>
  <span class="chip caut">caut</span>
  <table class="dec"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
  <div class="kcard ns hon">hon</div>
  <div class="step win">win</div>
  <span class="pill ok">ok</span>
  <div class="fig">not a figure</div>
</section>
</body>
</html>
`;

function seed(html = LEGACY, title = 'Legacy spec') {
  const id = createSpec({ title, html });
  writeFileSync(specHtmlPath(id), html);
  return id;
}
const read = (id) => readFileSync(specHtmlPath(id), 'utf8');

// ---- the codemod: one target, or no rename ----

test('every rename names exactly one outcome, and no source maps two ways', () => {
  for (const r of RENAMES) {
    // A target class, or null for the one case where the element already says
    // what the class said and the class is dropped.
    assert.ok(r.to === null || (typeof r.to === 'string' && r.to.length), `${r.from} names one outcome`);
  }
  const keys = RENAMES.map((r) => [r.on || '*', ...(r.within || []).sort(), r.from].join('.'));
  assert.equal(new Set(keys).size, keys.length, 'no source has two targets in one context');
});

test('the callout vocabularies are renamed inside a callout', () => {
  const { html } = codemod(LEGACY);
  assert.match(html, /class="callout risk"/);
  assert.match(html, /class="callout success"/);
  assert.match(html, /class="callout note"/);
  assert.match(html, /class="callout assumption"/);
  assert.match(html, /class="callout warning"/);
  assert.match(html, /class="callout decision"/);
  assert.doesNotMatch(html, /class="callout c-risk"/);
  assert.doesNotMatch(html, /\bcallout (c-win|c-key|asm|caut|dec|hon|win)\b/);
});

// The finding that shaped this pass: `asm` is 31 uses in the store and only one
// of them is a callout. Renaming the class everywhere would put a notice type on
// 30 chips and cards, where it means nothing and the lint would then flag it.
test('the same word outside a callout is left alone', () => {
  const { html } = codemod(LEGACY);
  assert.match(html, /class="chip asm"/, 'a chip is not a notice');
  assert.match(html, /class="chip caut"/);
  assert.match(html, /<table class="dec">/, 'a table is not a decision notice');
  assert.match(html, /class="kcard ns hon"/);
  assert.match(html, /class="step win"/);
  assert.match(html, /class="pill ok"/, 'only `tag ok` names the tag variant');
});

test('tag ok becomes tag good, grid2 becomes grid', () => {
  const { html } = codemod(LEGACY);
  assert.match(html, /class="tag good"/);
  assert.doesNotMatch(html, /class="tag ok"/);
  assert.match(html, /<div class="grid">/);
  assert.doesNotMatch(html, /class="grid2"/);
});

test('fig is dropped from a figure and kept on anything else', () => {
  const { html } = codemod(LEGACY);
  assert.match(html, /<figure>/, 'the element already says what the class said');
  assert.match(html, /<div class="fig">not a figure<\/div>/, 'a div named fig is not one');
});

test('a class nobody else uses is untouched, and so is its CSS', () => {
  const { html } = codemod(LEGACY);
  assert.match(html, /class="bespoke"/);
  assert.match(html, /\.bespoke\{outline:1px dotted var\(--line\)\}/);
});

test('the codemod reports what it changed, with counts', () => {
  const { changes } = codemod(LEGACY);
  const risk = changes.find((c) => c.from === 'c-risk');
  assert.deepEqual({ from: risk.from, to: risk.to, count: risk.count }, { from: 'c-risk', to: 'risk', count: 1 });
  assert.ok(!changes.some((c) => c.count === 0), 'a rename that fired nothing is not reported');
});

test('the codemod does not touch the stylesheet or a code example', () => {
  const html = `${LEGACY.replace('</section>', '<pre><code>&lt;div class="c-risk"&gt;&lt;/div&gt;</code></pre></section>')}`;
  const out = codemod(html).html;
  assert.match(out, /\.c-risk\{border-left:3px solid var\(--red\)\}/, 'the spec keeps its own rules');
  assert.match(out, /&lt;div class="c-risk"&gt;/, 'an escaped example is text, not markup');
});

test('running the codemod twice changes nothing the second time', () => {
  const once = codemod(LEGACY).html;
  assert.equal(codemod(once).html, once);
});

// ---- the classifier ----

test('warn: a trigger and a consequence is a risk', () => {
  const r = classify('The block is hand-edited. Trigger: styling a one-off inside the markers. Consequence: the next sync overwrites it.', 'warn');
  assert.equal(r.type, 'risk');
  assert.ok(r.signal, 'and it says which signal decided');
});

test('warn: an unverified belief is an assumption', () => {
  assert.equal(classify('We believe 34 components cover what specs need.', 'warn').type, 'assumption');
  assert.equal(classify('34 components cover what specs need. Falsified by: an author reaching outside the registry.', 'warn').type, 'assumption');
});

test('warn: a limit with a unit is a constraint', () => {
  assert.equal(classify('A spec must render in under 200 ms with no network.', 'warn').type, 'constraint');
  assert.equal(classify('A spec renders from file:// with no network. Source: house rules, Format.', 'warn').type, 'constraint');
});

test('warn: no signal takes the warning default, and says so', () => {
  const r = classify('Three findings in section 15 are the same complaint.', 'warn');
  assert.equal(r.type, 'warning');
  assert.equal(r.signal, null, 'nothing in the text decided it');
});

test('bare: a choice with an alternative is a decision, an instance is an example', () => {
  assert.equal(classify('The port is the singleton, chosen instead of a lockfile.', '').type, 'decision');
  assert.equal(classify('The port is the singleton. Not taken: a pid file with a liveness probe.', '').type, 'decision');
  assert.equal(classify('For example, a spec with two open questions cannot start.', '').type, 'example');
  assert.equal(classify('The registry is generated from the definitions.', '').type, 'note');
});

test('good: an optional action is a tip, otherwise success', () => {
  assert.equal(classify('You can collapse the rail on a narrow window.', 'good').type, 'tip');
  assert.equal(classify('Every one of the 171 tests passed.', 'good').type, 'success');
});

test('bad: departing from a stated rule is a deviation, otherwise danger', () => {
  assert.equal(classify('This departs from the house rule on palette tokens.', 'bad').type, 'deviation');
  assert.equal(classify('The store is unrecoverable once this runs.', 'bad').type, 'danger');
});

// The defaults are the weakest claim in each group, so an inference understates
// rather than overstates what the original said.
test('every default is the weakest claim in its group', () => {
  assert.equal(classify('x', 'warn').type, 'warning');
  assert.equal(classify('x', '').type, 'note');
  assert.equal(classify('x', 'good').type, 'success');
  assert.equal(classify('x', 'bad').type, 'danger');
});

// ---- the work list ----

test('the work list carries every untyped callout, with its text', () => {
  const html = `${LEGACY.replace('<div class="callout c-risk">The stamped block is hand-edited.</div>',
    '<div class="callout warn">Something to classify.</div><div class="callout">Bare.</div>')}`;
  const blocks = ambiguousBlocks(codemod(html).html);
  assert.ok(blocks.some((b) => b.source === 'warn' && /Something to classify/.test(b.text)));
  assert.ok(blocks.some((b) => b.source === '' && /Bare\./.test(b.text)));
  assert.ok(!blocks.some((b) => /hand-edited/.test(b.text)), 'a typed callout needs no decision');
});

test('a callout the codemod typed is not in the work list', () => {
  assert.equal(ambiguousBlocks(codemod(LEGACY).html).length, 0);
});

// ---- end to end ----

test('migrate leaves the spec on the library and stamped', () => {
  const id = seed();
  const report = migrateSpec(id);
  const html = read(id);
  assert.ok(optedIn(html), 'the attribute says it is on the library');
  assert.equal(readBlock(html).present, true, 'and it carries the block');
  assert.equal(report.id, id);
});

// What migration is answerable for: every notice carries a type, and no tone
// class is used as one. Classes outside the library still show, because the
// design leaves a class nobody else uses exactly where it is — removing it would
// change how that spec renders. So the assertion is that what remains is only
// that, never a legacy notice vocabulary.
test('a migrated spec has no untyped notices, and keeps its private classes', () => {
  const id = seed();
  migrateSpec(id);
  const { applies, problems } = checkComponents(read(id));
  assert.equal(applies, true, 'the lint runs on it now');
  assert.ok(!problems.some((p) => /no type|tone class/.test(p)), 'every notice carries a type');
  const stray = problems.filter((p) => /outside the library/.test(p)).join(' ');
  assert.match(stray, /bespoke/, 'a one-off class is left in place');
  assert.match(stray, /chip/, 'and so is the vocabulary that is not a notice here');
  assert.doesNotMatch(stray, /c-risk|c-win|c-key|grid2/, 'nothing the codemod owns is left');
});

test('the report separates what was deterministic from what was inferred', () => {
  const id = seed(LEGACY.replace('<div class="callout caut">Watch the density rule.</div>',
    '<div class="callout warn">Nothing here decides it.</div>'));
  const report = migrateSpec(id);
  assert.ok(report.codemod.length, 'renames are recorded');
  const inferred = report.assignments.find((a) => /Nothing here decides it/.test(a.text));
  assert.equal(inferred.assigned, 'warning');
  assert.equal(inferred.by, 'classifier');
  assert.equal(inferred.signal, null, 'and that nothing in the text decided it');
});

test('the report lands in the spec directory and reads back', () => {
  const id = seed();
  migrateSpec(id);
  assert.ok(existsSync(reportPath(id)));
  assert.equal(readReport(id).id, id);
});

const AMBIGUOUS = LEGACY.replace('<div class="callout caut">Watch the density rule.</div>',
  '<div class="callout warn">Nothing here decides it.</div>');

const target = (id) => ambiguousBlocks(codemod(read(id)).html)
  .find((b) => /Nothing here decides it/.test(b.text));

test('an agent assignment wins over the classifier and is recorded as one', () => {
  const id = seed(AMBIGUOUS);
  const report = migrateSpec(id, { assign: { [target(id).key]: 'risk' } });
  assert.match(read(id), /class="callout risk">Nothing here decides it/);
  const a = report.assignments.find((x) => /Nothing here decides it/.test(x.text));
  assert.equal(a.by, 'agent');
});

test('an assignment naming something that is not a notice type is refused', () => {
  const id = seed(AMBIGUOUS);
  assert.throws(() => migrateSpec(id, { assign: { [target(id).key]: 'c-risk' } }), /not a notice type/);
});

// A plan and the apply that follows it are two runs against a file a person can
// edit in between. An assignment names a block by the hash of its text, so it
// either finds what the agent read or finds nothing, and finding nothing stops
// the run rather than silently taking a default on a block nobody looked at.
test('an assignment survives the block moving', () => {
  const id = seed(AMBIGUOUS);
  const key = target(id).key;
  // The same blocks, reordered: the index the plan reported now names another one.
  writeFileSync(specHtmlPath(id), read(id).replace(
    '<div class="callout warn">Nothing here decides it.</div>\n  <div class="callout dec">',
    '<div class="callout dec">',
  ).replace('<span class="tag ok">done</span>',
    '<div class="callout warn">Nothing here decides it.</div>\n  <span class="tag ok">done</span>'));

  migrateSpec(id, { assign: { [key]: 'risk' } });
  assert.match(read(id), /class="callout risk">Nothing here decides it/, 'it followed the text');
});

test('an assignment for a block that is gone stops the run and names it', () => {
  const id = seed(AMBIGUOUS);
  const key = target(id).key;
  writeFileSync(specHtmlPath(id), read(id).replace('Nothing here decides it.', 'Rewritten since the plan.'));
  assert.throws(() => migrateSpec(id, { assign: { [key]: 'risk' } }), new RegExp(`no longer there[\\s\\S]*${key}`));
});

test('the work list names each block by a key that follows its text', () => {
  const blocks = ambiguousBlocks(codemod(AMBIGUOUS).html);
  assert.ok(blocks.every((b) => /^[0-9a-f]{10}$/.test(b.key)), 'every block has one');
  assert.equal(new Set(blocks.map((b) => b.key)).size, blocks.length, 'and they differ');
});

test('migrate refuses an id that is not the shape of one', () => {
  assert.throws(() => migrateSpec('abc; rm -rf /'), /not a spec id/);
  assert.throws(() => migrateSpec('../../etc/passwd'), /not a spec id/);
});

test('a dry run reports everything and writes nothing', () => {
  const id = seed();
  const before = read(id);
  const report = migrateSpec(id, { dry: true });
  assert.equal(read(id), before, 'the spec is untouched');
  assert.equal(existsSync(reportPath(id)), false, 'and so is the store');
  assert.ok(report.codemod.length, 'but the report says what would happen');
});

// The spec's own stylesheet outlives the migration, so a rule it defines under a
// name the library also defines silently wins over the library's.
test('a class the spec redefines under a library name is reported as a conflict', () => {
  const id = seed(LEGACY.replace('.bespoke{outline:1px dotted var(--line)}', '.risk{color:var(--red)}'));
  const report = migrateSpec(id);
  assert.ok(report.conflicts.includes('risk'), 'the reader is told which rule wins');
});

test('migrating twice is a no-op the second time', () => {
  const id = seed();
  migrateSpec(id);
  const after = read(id);
  migrateSpec(id);
  assert.equal(read(id), after);
});

test('migrate refuses an id that is not in the store', () => {
  assert.throws(() => migrateSpec('nope'), /not found/);
});

test('the report directory is the spec directory', () => {
  const id = seed();
  assert.equal(reportPath(id), join(specDir(id), 'migration.json'));
});

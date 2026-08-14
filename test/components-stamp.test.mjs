// Stamping the component stylesheet into a spec.
//
// A spec must render opened straight from disk (house rules, Format), so the
// stylesheet is copied into every spec rather than linked. That makes the copy a
// generated artifact living inside a hand-authored file, and the two rules that
// keeps honest are here: a re-stamp must not rewrite a file that has not
// changed, and a block someone edited by hand must not be silently overwritten.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildCss, START, VERSION } from '../lib/components-build.mjs';
import { stampHtml, readBlock, syncSpec, syncAll, ATTR } from '../lib/components-stamp.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-stamp-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const SPEC = (extra = '') => `<!DOCTYPE html>
<html lang="en" data-theme="light" data-sf-spec-status="draft"${extra}>
<head><meta charset="utf-8"><title>T</title>
<style>
  :root{--bg:#0f1115}
  body{margin:0}
</style>
</head>
<body><main><h1>T</h1></main></body></html>`;

/** Write a spec into the store and return its id. */
function seed(id, html) {
  mkdirSync(join(home, 'specs', id), { recursive: true });
  writeFileSync(join(home, 'specs', id, 'spec.html'), html);
  writeFileSync(join(home, 'specs', id, 'meta.json'), JSON.stringify({ id, title: id, status: 'draft' }));
  return id;
}
const specHtml = (id) => readFileSync(join(home, 'specs', id, 'spec.html'), 'utf8');

// ---- stamping a string ----

test('stamping inserts the block at the top of the style element', () => {
  const out = stampHtml(SPEC());
  assert.ok(out.includes(START), 'the opening marker');
  assert.ok(out.includes('specforge:components end'), 'the closing marker');
  assert.ok(out.indexOf(START) < out.indexOf('--bg'), 'library first, so a spec can override it');
  assert.match(out, new RegExp(`${ATTR}="${VERSION}"`), 'the version is recorded on <html>');
});

// The whole reason the generator is deterministic: `sync --all` runs over the
// store, and a stamp that rewrote unchanged files would produce a diff on every
// spec nobody edited.
test('stamping twice is byte-identical', () => {
  const once = stampHtml(SPEC());
  assert.equal(stampHtml(once), once);
});

test('stamping replaces an older block rather than appending one', () => {
  const old = stampHtml(SPEC()).replace(buildCss(), `${START}\n.callout{color:red}\n/* specforge:components end sha=deadbeef */\n`);
  const out = stampHtml(old, { force: true });
  assert.equal((out.match(/specforge:components v\d+ start/g) || []).length, 1, 'one block, not two');
  assert.ok(!out.includes('color:red'), 'the old body is gone');
});

test('a spec with no style element is refused rather than guessed at', () => {
  assert.throws(() => stampHtml('<html><head></head><body></body></html>'), /style/i);
});

// ---- reading a block back ----

test('readBlock reports the version and whether the body is untouched', () => {
  const html = stampHtml(SPEC());
  const b = readBlock(html);
  assert.equal(b.present, true);
  assert.equal(b.version, VERSION);
  assert.equal(b.edited, false, 'a freshly stamped block is not edited');
});

test('readBlock detects a hand-edited block', () => {
  const html = stampHtml(SPEC()).replace('.callout{position:relative', '.callout{color:red;position:relative');
  const b = readBlock(html);
  assert.equal(b.present, true);
  assert.equal(b.edited, true, 'the recorded hash no longer matches the body');
});

test('readBlock on a pre-library spec reports absent', () => {
  assert.deepEqual(readBlock(SPEC()), { present: false, version: null, edited: false });
});

// ---- syncing a spec in the store ----

test('sync stamps a spec and reports what changed', () => {
  const id = seed('aaa1111111', SPEC());
  const r = syncSpec(id);
  assert.equal(r.changed, true);
  assert.equal(r.version, VERSION);
  assert.ok(specHtml(id).includes(START));

  const again = syncSpec(id);
  assert.equal(again.changed, false, 'a second sync is a no-op');
  assert.equal(specHtml(id), specHtml(id));
});

test('sync refuses a hand-edited block and names the spec', () => {
  const id = seed('bbb2222222', SPEC());
  syncSpec(id);
  const edited = specHtml(id).replace('.callout{position:relative', '.callout{color:red;position:relative');
  writeFileSync(join(home, 'specs', id, 'spec.html'), edited);
  assert.throws(() => syncSpec(id), /edited|hand/i);
  assert.ok(specHtml(id).includes('color:red'), 'and leaves the edit in place');
});

test('sync --force overwrites a hand-edited block, because refusing forever is not a fix', () => {
  const id = seed('ccc3333333', SPEC());
  syncSpec(id);
  writeFileSync(join(home, 'specs', id, 'spec.html'),
    specHtml(id).replace('.callout{position:relative', '.callout{color:red;position:relative'));
  const r = syncSpec(id, { force: true });
  assert.equal(r.changed, true);
  assert.ok(!specHtml(id).includes('color:red'));
});

// D5: no automatic migration. A spec that never opted in is not touched, which
// is what keeps `sync --all` safe to run against a store of 111 existing specs.
test('sync --all skips every spec that has not opted in', () => {
  const inLibrary = seed('ddd4444444', stampHtml(SPEC()));
  const pre = seed('eee5555555', SPEC());
  const before = specHtml(pre);

  const r = syncAll();
  assert.deepEqual(r.skipped, [pre], 'the pre-library spec is skipped by id');
  assert.ok(r.synced.includes(inLibrary) || r.unchanged.includes(inLibrary), 'the opted-in spec is considered');
  assert.equal(specHtml(pre), before, 'and the pre-library spec is byte-identical');
});

// The exclusion has to hold at creation too, not only in the repo templates: a
// deck stamped at create time carries the library AND the deck's own 18
// duplicate definitions, and renders as a mixture of the two.
test('the deck is excluded from stamping until its duplicates are reconciled', async () => {
  const { STAMPED_TYPES, STAMPED_TEMPLATES, stampsAtCreate } = await import('../lib/components-build.mjs');
  const { SPEC_TYPES } = await import('../lib/meta.mjs');

  assert.equal(stampsAtCreate('deck'), false, 'a deck is not stamped');
  assert.ok(!STAMPED_TEMPLATES.includes('spec-base-deck.html'), 'nor is its template');
  for (const type of SPEC_TYPES.filter((t) => t !== 'deck')) {
    assert.equal(stampsAtCreate(type), true, `${type} is stamped`);
  }
  // Every type is accounted for, so a type added later cannot silently miss the
  // library by being forgotten here.
  assert.deepEqual([...STAMPED_TYPES, 'deck'].sort(), [...SPEC_TYPES].sort());
});

// ---- the templates ----

test('every stamped template carries the block and the version', async () => {
  const { STAMPED_TEMPLATES } = await import('../lib/components-build.mjs');
  const { fileURLToPath } = await import('node:url');
  const root = join(fileURLToPath(new URL('../', import.meta.url)));
  for (const name of STAMPED_TEMPLATES) {
    const html = readFileSync(join(root, 'templates', name), 'utf8');
    const b = readBlock(html);
    assert.equal(b.present, true, `${name} carries the block`);
    assert.equal(b.version, VERSION, `${name} is at the current version`);
    assert.equal(b.edited, false, `${name} block is generated, not hand-edited`);
    assert.match(html, new RegExp(`${ATTR}="${VERSION}"`), `${name} records the version on <html>`);
  }
});

// Two definitions of a card in one file is the state the library exists to end.
// The deck is absent from STAMPED_TEMPLATES until Stage 7 reconciles its 18
// duplicate classes, which is why this iterates the stamped list rather than the
// directory.
test('no stamped template redefines a class the library owns', async () => {
  const { STAMPED_TEMPLATES } = await import('../lib/components-build.mjs');
  const { COMPONENTS, BASE_CLASSES } = await import('../components/index.mjs');
  const { fileURLToPath } = await import('node:url');
  const root = join(fileURLToPath(new URL('../', import.meta.url)));

  const owned = new Set([
    ...BASE_CLASSES,
    ...COMPONENTS.flatMap((c) => [c.kind === 'class' ? c.name : null, ...(c.variants || [])]).filter(Boolean),
  ]);

  for (const name of STAMPED_TEMPLATES) {
    const html = readFileSync(join(root, 'templates', name), 'utf8');
    // Everything after the generated block is the template's own CSS.
    const own = html.split('specforge:components end')[1].split('</style>')[0];
    const dup = [...new Set([...own.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))].filter((c) => owned.has(c));
    assert.deepEqual(dup, [], `${name} redefines library classes`);
  }
});

test('sync --all reports a hand-edited spec instead of stopping the run', () => {
  const good = seed('fff6666666', stampHtml(SPEC()));
  const bad = seed('ggg7777777', stampHtml(SPEC()).replace('.callout{position:relative', '.callout{color:red;position:relative'));

  const r = syncAll();
  assert.deepEqual(r.refused.map((x) => x.id), [bad], 'the edited one is refused by name');
  assert.ok(!r.refused.length || r.refused[0].reason, 'with a reason');
  assert.ok([...r.synced, ...r.unchanged].includes(good), 'and the rest still ran');
});

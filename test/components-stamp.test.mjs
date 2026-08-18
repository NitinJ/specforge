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

// An imported spec does not have to use the bare tag the templates happen to
// use, and refusing to stamp it would be a refusal nobody could act on.
test('any valid style tag is stamped, not only the bare one', () => {
  for (const tag of ['<style type="text/css">', '<style media="screen">', '<STYLE>']) {
    const html = `<!DOCTYPE html><html data-sf-spec-status="draft"><head><title>T</title>
${tag}
  body{margin:0}
</${tag.slice(1, 6).toLowerCase()}>
</head><body><main><h1>T</h1></main></body></html>`;
    const out = stampHtml(html);
    assert.ok(out.includes(START), `${tag} is stamped`);
    assert.equal(readBlock(out).present, true, `${tag} block reads back`);
  }
});

// An opt-in written in valid HTML that the templates do not happen to produce
// must still count. Reading it as absent would silently skip that spec in both
// `sync --all` and the lint, which is the quietest possible failure.
test('an opt-in is recognised however the html tag is written', async () => {
  const { optedIn, optedInVersion } = await import('../lib/components-stamp.mjs');
  const variants = [
    `<html lang="en" ${ATTR}="1">`,
    `<HTML LANG="en" ${ATTR}="1">`,
    `<html ${ATTR}='1'>`,
    `<html ${ATTR} = "1">`,
    `<html\n  ${ATTR}="1">`,
  ];
  for (const tag of variants) {
    const html = `<!DOCTYPE html>${tag}<head><title>T</title><style>body{}</style></head><body></body></html>`;
    assert.equal(optedIn(html), true, `opted in: ${tag.replace(/\n/g, ' ')}`);
    assert.equal(optedInVersion(html), 1);
  }
  assert.equal(optedIn('<html lang="en"><head></head><body></body></html>'), false);
});

// A spec can carry more than one stylesheet. Looking only at the first would
// read an existing block in a later one as absent and insert a second copy, so
// the spec would carry two definitions of every component.
test('a block in a later style element is found, not duplicated', () => {
  const two = (blockIn) => `<!DOCTYPE html><html data-sf-spec-status="draft"><head><title>T</title>
<style>${blockIn === 0 ? 'BLOCK' : '  body{margin:0}'}</style>
<style media="print">${blockIn === 1 ? 'BLOCK' : '  h1{font-size:20px}'}</style>
</head><body><main><h1>T</h1></main></body></html>`;

  // Stamped into the first when there is no block anywhere.
  const fresh = stampHtml(two(-1));
  assert.equal((fresh.match(/specforge:components v\d+ start/g) || []).length, 1);

  // Stamped in place when the block already lives in the second.
  const inSecond = two(1).replace('BLOCK', buildCss().trim());
  assert.equal(readBlock(inSecond).present, true, 'a block in the second sheet is found');
  const out = stampHtml(inSecond);
  assert.equal((out.match(/specforge:components v\d+ start/g) || []).length, 1, 'still one block');
  assert.ok(out.split('<style media="print">')[1].includes('specforge:components'),
    'and it stayed where it was');
});

// Reading a tag loosely is only half the job: writing it back has to survive the
// same variety. Slicing at a lowercase `html` produced `<htmlML LANG="en">` on an
// uppercase root tag, corrupting exactly the imported documents the loose
// matching was added for.
test('stamping preserves the root tag it found, whatever its case', async () => {
  const { optedInVersion } = await import('../lib/components-stamp.mjs');
  for (const tag of ['<HTML LANG="en">', '<Html lang="en">', '<html lang="en">']) {
    const html = `<!DOCTYPE html>${tag}<head><title>T</title><style>body{}</style></head><body><h1>x</h1></body></html>`;
    const out = stampHtml(html);
    const root = out.match(/<[hH][tT][mM][lL][^>]*>/)[0];
    assert.ok(/^<(html|Html|HTML)\s/.test(root), `root tag intact, got ${root}`);
    assert.ok(root.includes('LANG="en"') || root.includes('lang="en"'), `attributes intact, got ${root}`);
    assert.equal(optedInVersion(out), VERSION, `and opted in, got ${root}`);
  }
});

test('stamping updates an existing attribute rather than adding a second', async () => {
  const { optedInVersion } = await import('../lib/components-stamp.mjs');
  const html = `<!DOCTYPE html><html ${ATTR}='0'><head><title>T</title><style>body{}</style></head><body></body></html>`;
  const out = stampHtml(html, { force: true });
  assert.equal((out.match(new RegExp(ATTR, 'g')) || []).length, 1, 'one attribute');
  assert.equal(optedInVersion(out), VERSION, 'at the current version');
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

// ---- a spec that writes ABOUT the library ----
//
// Both of these are regressions. `components sync --all` ran against the real
// store and rewrote the design spec for this library: it documents the marker
// format in a <pre><code> example, and it names the attribute in its prose. The
// opt-in test matched the prose, and the block regex matched the example, so the
// example was replaced with the whole stylesheet.

const DOCUMENTING_SPEC = `<!DOCTYPE html>
<html lang="en" data-theme="light" data-sf-spec-status="draft">
<head><meta charset="utf-8"><title>T</title>
<style>
  :root{--bg:#0f1115}
</style>
</head>
<body><main>
<p>The &lt;html&gt; element carries <code>${ATTR}="1"</code>. A spec without it is pre-library.</p>
<pre><code>&lt;style&gt;
  /* specforge:components v1 start: generated, do not edit */
  ...
  /* specforge:components end */
&lt;/style&gt;</code></pre>
</main></body></html>`;

test('a spec that only writes about the attribute has not opted in', () => {
  const id = seed('hhh8888888', DOCUMENTING_SPEC);
  const r = syncAll();
  assert.deepEqual(r.skipped, [id], 'prose mentioning the attribute is not consent');
  assert.equal(specHtml(id), DOCUMENTING_SPEC, 'and the file is byte-identical');
});

test('stamping never touches markers outside the stylesheet', () => {
  const out = stampHtml(DOCUMENTING_SPEC);
  assert.ok(out.includes('  /* specforge:components v1 start: generated, do not edit */\n  ...\n'),
    'the code example survives intact');
  assert.equal((out.match(/specforge:components v\d+ start/g) || []).length, 2,
    'one real block plus the one being written about');
  // The real block landed in the stylesheet, not in the body.
  const styleCss = out.slice(out.indexOf('<style>'), out.indexOf('</style>'));
  assert.ok(styleCss.includes('.callout.decision::before'), 'the stylesheet has the library');
});

test('readBlock ignores a block written about in the body', () => {
  assert.deepEqual(readBlock(DOCUMENTING_SPEC), { present: false, version: null, edited: false });
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
test('every spec type is on the library, the deck included', async () => {
  const { STAMPED_TYPES, STAMPED_TEMPLATES, stampsAtCreate } = await import('../lib/components-build.mjs');
  const { SPEC_TYPES } = await import('../lib/meta.mjs');

  assert.equal(stampsAtCreate('deck'), true, 'a deck is stamped like anything else');
  assert.ok(STAMPED_TEMPLATES.includes('spec-base-deck.html'), 'and so is its template');
  for (const type of SPEC_TYPES) {
    assert.equal(stampsAtCreate(type), true, `${type} is stamped`);
  }
  // Every type is accounted for, so a type added later cannot silently miss the
  // library by being forgotten here.
  assert.deepEqual([...STAMPED_TYPES].sort(), [...SPEC_TYPES].sort());
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

/**
 * The class names a selector defines, or null if it only adjusts one.
 *
 * A selector with one compound defines what it names: `.card`, `div.card` and
 * `.callout.warn` are all a second definition of a library component in a file
 * that already has the first. A selector with an ancestor adjusts a component
 * where it sits — `.slide .svg-box` says what a diagram box looks like on a
 * slide, and there is still one definition of a diagram box.
 */
function definedBy(selector) {
  const compounds = selector.trim().split(/\s+|\s*>\s*|\s*\+\s*|\s*~\s*/).filter(Boolean);
  if (compounds.length !== 1) return null;
  return [...compounds[0].matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

// Two definitions of a card in one file is the state the library exists to end.
test('no stamped template redefines a class the library owns', async () => {
  const { STAMPED_TEMPLATES } = await import('../lib/components-build.mjs');
  const { COMPONENTS, BASE_CLASSES } = await import('../components/index.mjs');
  const { fileURLToPath } = await import('node:url');
  const root = join(fileURLToPath(new URL('../', import.meta.url)));

  const owned = new Set([
    ...BASE_CLASSES,
    ...COMPONENTS.flatMap((c) => [c.kind === 'class' ? c.name : null, ...(c.variants || [])]).filter(Boolean),
  ]);

  const { selectors } = await import('../lib/components-build.mjs');
  for (const name of STAMPED_TEMPLATES) {
    const html = readFileSync(join(root, 'templates', name), 'utf8');
    // Everything after the generated block is the template's own CSS. Selectors
    // are parsed rather than matched, so prose naming a class is not a rule
    // defining one and a compact at-rule does not hide one.
    const own = html.split('specforge:components end')[1].split('</style>')[0];
    const dup = new Set();
    for (const selector of selectors(own)) {
      for (const c of definedBy(selector) || []) if (owned.has(c)) dup.add(c);
    }
    assert.deepEqual([...dup], [], `${name} redefines library classes`);
  }
});

// The class check above cannot see the failure that actually shipped.
//
// h2 to h5, `table` and `dl` are components written as ELEMENT selectors, and
// every shell carried its own copy of them after the stamped block — so the
// heading family landed in each shell and was immediately overridden by the same
// file. `definedBy` returns classes, so nothing fired. The library page had the
// same bug against `h2` and against `table`.
//
// This compares whole selectors instead, whitespace removed, which draws the line
// where it belongs: `.slide table` and `section[data-family] > h2` adjust a
// component where it sits and are fine, while a bare `table` or `h2` replaces it
// and is not.
test('nothing that carries the stamped block redefines a selector inside it', async () => {
  const { STAMPED_TEMPLATES, buildBody, selectors } = await import('../lib/components-build.mjs');
  const { buildDoc } = await import('../lib/components-doc.mjs');
  const { fileURLToPath } = await import('node:url');
  const root = join(fileURLToPath(new URL('../', import.meta.url)));

  const tight = (s) => s.replace(/\s+/g, '');
  const stamped = new Set(selectors(buildBody()).map(tight));

  const sources = STAMPED_TEMPLATES.map((name) => ({
    name, html: readFileSync(join(root, 'templates', name), 'utf8'),
  }));
  // The library page is generated rather than a template, and is the one page
  // where a shadowed component is invisible: it looks like the component itself
  // is wrong.
  sources.push({ name: '/components', html: buildDoc() });

  for (const { name, html } of sources) {
    const own = html.split('specforge:components end')[1].split('</style>')[0];
    const dup = selectors(own).map(tight).filter((s) => stamped.has(s));
    assert.deepEqual(dup, [], `${name} redefines stamped selectors`);
  }
});

// Both the generated vocabulary and the duplication test read the same parser,
// so a blind spot in it hides a shell class and lets a redefinition through at
// once.
test('a rule written inside a compact at-rule is still a rule', async () => {
  const { selectors } = await import('../lib/components-build.mjs');
  const css = '@media (max-width:900px){.fs-group{grid-column:1/-1}.card{margin:0}}\n.plain{color:red}';
  assert.deepEqual(selectors(css), ['.fs-group', '.card', '.plain']);
  assert.deepEqual(selectors('/* .commented {x} */ .real{y}'), ['.real'],
    'and a comment is not a rule');
});

// The other half of adoption: the deck keeps what the library has no equivalent
// for. A slide is a presentation surface, and the library does not extend into
// layout.
test('the deck keeps its slide layout', () => {
  const root = join(new URL('../', import.meta.url).pathname);
  const css = readFileSync(join(root, 'templates', 'spec-base-deck.html'), 'utf8')
    .split('specforge:components end')[1].split('</style>')[0];
  for (const c of ['slide', 'sl-hd', 'sl-body', 'deck-nav', 'filmstrip']) {
    assert.match(css, new RegExp(`\\.${c}\\b`), `.${c} is still defined`);
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

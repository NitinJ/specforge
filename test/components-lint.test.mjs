// The components lint check.
//
// Advisory in v1 (design D4): the inventory is a prediction made from 111
// samples, and enforcing it before it has covered real authoring turns every gap
// into a blocked author. It reports, names the component that likely fits, and
// never fails the lint.
//
// The exemption matters as much as the rules. A spec without
// `data-sf-components` is pre-library and reports nothing, which is what keeps
// D5 ("no automatic migration") true of the lint as well as of the stamp.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lintSpec } from '../lib/lint-spec.mjs';
import { buildCss } from '../lib/components-build.mjs';
import { ATTR } from '../lib/components-stamp.mjs';
import { VERSION } from '../lib/components-build.mjs';

/** A spec on the library, with `body` in its main. */
function spec(body, { attr = `${ATTR}="${VERSION}"`, css = buildCss() } = {}) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light" data-sf-spec-status="draft" ${attr}>
<head><meta charset="utf-8"><title>T</title>
<style>
${css}
  :root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212b;--ink:#e6e8ee;--muted:#9aa3b2;
    --line:#2a2f3a;--accent:#6ea8fe;--green:#3fb950;--amber:#d29922;--red:#f85149;
    --code:#11151c;--shadow:none;--mono:monospace}
  :root[data-theme="light"]{--bg:#fff;--panel:#fff;--panel2:#eee;--ink:#111;--muted:#666;
    --line:#ddd;--accent:#25f;--green:#1a3;--amber:#b53;--red:#b11;--code:#eee;--shadow:none;--mono:monospace}
  @media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#fff}}
</style></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>${body}</section></main>
<script>document.documentElement.setAttribute('data-theme','light');localStorage.getItem('x')</script>
</body></html>`;
}

const check = (html) => lintSpec(html).checks.find((c) => c.name === 'spec-components');

// ---- the check exists and never fails the lint ----

test('the components check is advisory, so a violation never fails the lint', () => {
  const r = lintSpec(spec('<div class="callout">no type</div>'));
  const c = r.checks.find((x) => x.name === 'spec-components');
  assert.ok(c, 'the check runs');
  assert.equal(c.advisory, true);
  assert.equal(c.ok, false, 'and reports the violation');
  assert.equal(r.ok, true, 'while the lint still passes');
});

test('a spec using the library cleanly reports nothing', () => {
  const c = check(spec('<div class="callout decision">A choice. <b>Criterion:</b> why.</div><p>Prose.</p>'));
  assert.equal(c.ok, true, c.detail);
});

// ---- one test per rule ----

// 273 of 640 callouts in the store carry no type. That is the single measured
// failure the library exists to remove, so it is the first thing the lint sees.
test('a notice with no type is reported', () => {
  const c = check(spec('<div class="callout">context</div>'));
  assert.equal(c.ok, false);
  assert.match(c.detail, /no type|untyped/i);
});

test('a tone class used directly is reported, and the type to use is named', () => {
  const c = check(spec('<div class="callout warn">careful</div>'));
  assert.equal(c.ok, false);
  assert.match(c.detail, /warn/, 'names what it found');
  assert.match(c.detail, /warning|assumption|risk/, 'and what to use instead');
});

test('a class outside the library is reported with the nearest component named', () => {
  const c = check(spec('<div class="callout c-risk">a risk</div>'));
  assert.equal(c.ok, false);
  assert.match(c.detail, /c-risk/);
  assert.match(c.detail, /risk/, 'suggests the library component it resembles');
});

test('an unknown class with no near match is still reported', () => {
  const c = check(spec('<div class="zzzqqq">something</div>'));
  assert.equal(c.ok, false);
  assert.match(c.detail, /zzzqqq/);
});

// A slide, a filmstrip and a table of contents are the shell a spec is authored
// in, not drift. The list that made that distinction was hand-picked and named
// eight; the deck shell alone defines 43, so every deck reported them forever.
test('the shell a spec is authored in is not reported as drift', async () => {
  const { SHELL_CLASSES } = await import('../lib/shell-classes.mjs');
  for (const cls of ['slide', 'filmstrip', 'sl-hd', 'sl-notes', 'fs-item', 'toc', 'layout']) {
    assert.ok(SHELL_CLASSES.has(cls), `.${cls} is shell vocabulary`);
  }
  const c = check(spec('<div class="slide"><div class="sl-hd"><p class="sl-num">01</p></div></div>'));
  assert.equal(c.ok, true, 'and none of it is reported');
});

// Derived, not listed: a template that grows a class must not start failing the
// lint that reads this, and a class the library owns is not shell vocabulary.
test('the shell vocabulary is regenerated from the templates', async () => {
  const { shellClasses } = await import('../lib/components-build.mjs');
  const { SHELL_CLASSES } = await import('../lib/shell-classes.mjs');
  const { componentClasses } = await import('../components/index.mjs');
  assert.deepEqual(shellClasses(), [...SHELL_CLASSES],
    'the generated module is current; run components build');
  const owned = new Set(componentClasses());
  assert.deepEqual([...SHELL_CLASSES].filter((c) => owned.has(c)), [],
    'a shell adjusting a component does not claim its name');
});

test('a stale stamped block is reported', () => {
  const stale = buildCss()
    .replace(/v\d+ start/, 'v0 start')
    .replace(/sha=[0-9a-f]+/, 'sha=00000000');
  const c = check(spec('<p>Prose.</p>', { css: stale }));
  assert.equal(c.ok, false);
  assert.match(c.detail, /block|version|stale/i);
});

// Emphasis everywhere is emphasis nowhere. The threshold is asserted rather than
// measured (design Q3, resolved), and stated in references/spec-components.md.
test('notice density above one per 400 words is reported', () => {
  const words = new Array(60).fill('word').join(' ');
  const dense = `<p>${words}</p>` + new Array(4).fill('<div class="callout note">n</div>').join('');
  const c = check(spec(dense));
  assert.equal(c.ok, false);
  assert.match(c.detail, /densit|per 400|too many/i);
});

test('a spec under the density threshold is not reported for it', () => {
  const words = new Array(500).fill('word').join(' ');
  const c = check(spec(`<p>${words}</p><div class="callout note">one</div>`));
  assert.equal(c.ok, true, c.detail);
});

// ---- the exemption: 113 specs in the store never opted in ----

test('a pre-library spec reports nothing at all', () => {
  const pre = spec('<div class="callout warn">a</div><div class="grid2">b</div>', { attr: '', css: '' });
  const c = check(pre);
  assert.ok(!c || c.ok === true, 'no components check fires without the attribute');
});

test('the check keys on the attribute, not on the presence of a block', () => {
  // A spec that carries the stylesheet but never opted in is still pre-library.
  const c = check(spec('<div class="callout">x</div>', { attr: '' }));
  assert.ok(!c || c.ok === true);
});

// The same defect that let `sync --all` rewrite the design spec: a document-wide
// match reads a spec writing ABOUT the attribute as a spec carrying it.
test('a pre-library spec that writes about the attribute in prose stays exempt', () => {
  const html = spec(
    `<p>The &lt;html&gt; element carries <code>${ATTR}="1"</code>.</p><div class="callout">x</div>`,
    { attr: '', css: '' },
  );
  const c = check(html);
  assert.ok(!c || c.ok === true, 'prose is not consent');
});

// The lint tells an author a block component is commentable. If the review
// client's anchor list did not follow, that is a promise the page cannot keep:
// text inside a .diff or a .flow would be uncommentable while the lint called it
// fine. Both derive from the definitions now.
test('every block component the lint accepts is one the review client can anchor', async () => {
  const { blockComponents } = await import('../components/index.mjs');
  const { injectReviewLayer } = await import('../server/inject.mjs');
  const { readFileSync } = await import('node:fs');

  const out = injectReviewLayer('<html><head></head><body><h1>x</h1></body></html>', { specId: 'abc' });
  const cfg = JSON.parse(out.match(/window\.SPECFORGE = (\{[\s\S]*?\});/)[1]);
  assert.deepEqual(cfg.blocks, blockComponents(), 'the client is handed the library list');

  const client = readFileSync(new URL('../server/public/review.js', import.meta.url), 'utf8');
  assert.match(client, /BLOCK_SEL[\s\S]{0,400}SPECFORGE \|\| \{\}\)\.blocks/,
    'and appends it to its anchor selector');
});

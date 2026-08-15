// Syntax highlighting in the review layer.
//
// Two measurements decide the shape of this, both taken across the 117 specs in
// the store:
//
//   1. 0 of 133 code blocks declare a language.
//   2. About half of them are not a language at all — ASCII data-flow diagrams,
//      pseudo-code with prose annotations, structural sketches.
//
// So nothing is ever detected. A block is highlighted when its author says what
// it is and not otherwise, because guessing would colour a box-drawing diagram
// as if it were code, and a wrong highlight reads worse than none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const REVIEW_JS = new URL('../server/public/review.js', import.meta.url);
const REVIEW_CSS = new URL('../server/public/review.css', import.meta.url);

/**
 * Boot the review layer over `body`, with a stub Prism already present so the
 * highlighting decision is observable without executing the vendored file.
 */
async function boot(t, body, { withPrism = true } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  // review.js installs a poll timer; without this the runner never exits.
  t.after(() => window.close());
  window.SPECFORGE = { specId: 'test-spec', prefs: {}, transport: 'sse' };
  window.fetch = () => Promise.resolve({
    ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('{"threads":[]}'),
  });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };

  const highlighted = [];
  if (withPrism) {
    window.Prism = {
      languages: { python: {}, yaml: {}, javascript: {}, json: {}, bash: {}, sql: {}, diff: {} },
      highlightElement: (el) => highlighted.push(el),
    };
  }

  const script = window.document.createElement('script');
  script.textContent = readFileSync(REVIEW_JS, 'utf8');
  window.document.body.appendChild(script);
  await new Promise((r) => setTimeout(r, 30));
  return { window, highlighted, dom };
}

const scriptSrcs = (window) =>
  [].map.call(window.document.querySelectorAll('script[src]'), (s) => s.getAttribute('src'));

// ---- what gets highlighted ----

test('a block whose author declared a language is highlighted', async (t) => {
  const { window, highlighted } = await boot(t, 
    '<main><pre><code class="language-python">def f(): pass</code></pre></main>',
  );
  assert.equal(highlighted.length, 1, 'the one declared block');
  assert.equal(highlighted[0].tagName, 'CODE', 'the code element, not the pre');
  assert.match(window.document.querySelector('code').className, /language-python/);
});

test('a block with no declared language is left alone', async (t) => {
  const { highlighted } = await boot(t, 
    '<main><pre><code>users/{src} ─► defaultWardrobe/{id}</code></pre></main>',
  );
  assert.deepEqual(highlighted, [], 'an ASCII diagram is not code in a language');
});

test('data-lang is accepted on the pre, the code, or the block that wraps them', async (t) => {
  const { window, highlighted } = await boot(t, `<main>
    <div class="codeblock" data-lang="yaml"><pre><code>a: 1</code></pre></div>
    <pre data-lang="json"><code>{"a":1}</code></pre>
    <pre><code data-lang="sql">SELECT 1</code></pre>
  </main>`);
  assert.equal(highlighted.length, 3, 'all three shapes are honoured');
  const classes = [].map.call(window.document.querySelectorAll('code'), (c) => c.className);
  assert.deepEqual(classes, ['language-yaml', 'language-json', 'language-sql'],
    'each lands as the class Prism reads, wherever the author wrote it');
});

test('a language with no grammar is left alone rather than mangled', async (t) => {
  const { highlighted } = await boot(t, 
    '<main><pre><code class="language-brainfuck">+[-]</code></pre></main>',
  );
  assert.deepEqual(highlighted, [], 'no grammar, no highlight');
});

test('a bare pre with a language and no code element is still highlighted', async (t) => {
  const { highlighted } = await boot(t, '<main><pre data-lang="bash">npm test</pre></main>');
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].tagName, 'PRE');
});

// ---- what it costs a spec that has none ----

test('a spec with no declared language fetches no highlighter', async (t) => {
  const { window } = await boot(t, '<main><p>Prose only.</p><pre><code>plain</code></pre></main>',
    { withPrism: false });
  assert.deepEqual(scriptSrcs(window).filter((s) => /prism/.test(s)), [],
    'nothing is loaded until a block asks for it');
});

test('a spec with a declared language loads the highlighter once', async (t) => {
  const { window } = await boot(t, `<main>
    <pre><code class="language-python">a = 1</code></pre>
    <pre><code class="language-yaml">a: 1</code></pre>
  </main>`, { withPrism: false });
  const srcs = scriptSrcs(window).filter((s) => /prism/.test(s));
  assert.deepEqual(srcs, ['/public/prism.js'], 'one load, served by the daemon, not a CDN');
});

// ---- theming ----

// The 6 review-layer theme variants redefine --accent/--green/--amber/--red/
// --ink/--muted and nothing else. Mapping the token classes onto those is what
// makes highlighting follow every theme without a stylesheet per theme.
test('every highlight colour is a palette token, so it follows the theme', () => {
  const css = readFileSync(REVIEW_CSS, 'utf8');
  const block = css.slice(css.indexOf('/* syntax highlighting'));
  assert.ok(block.length > 200, 'the highlight section exists');

  const rules = [...block.matchAll(/\.token\.[\w-]+[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 6, 'the token classes are mapped');
  for (const decl of rules) {
    const colours = [...decl.matchAll(/(?:^|[\s:])(#[0-9a-f]{3,8}|rgb\(|hsl\()/gi)];
    assert.deepEqual(colours.map((c) => c[1]), [],
      `a literal colour would not follow the theme: ${decl.trim()}`);
  }
  for (const token of ['comment', 'keyword', 'string', 'number', 'function']) {
    assert.match(block, new RegExp(`\\.token\\.${token}\\b`), `.token.${token} is mapped`);
  }
});

// review.js calls boot() at a readyState check part-way down the file, so a
// `var` declared below that line is still undefined when boot reads it. The file
// already carries three comments about this; the highlighter made it four, and
// the symptom was <script src="undefined">, a 404, and no highlighting, with
// nothing thrown. jsdom did not reproduce it. This does.
test('every constant boot() reads is declared before boot() runs', () => {
  const js = readFileSync(REVIEW_JS, 'utf8');
  const bootAt = js.indexOf("if (document.readyState !== 'loading') boot();");
  assert.ok(bootAt > 0, 'the readyState check is where boot runs');
  const above = js.slice(0, bootAt);
  for (const name of ['HIGHLIGHT_SRC', 'SLIDE_SEL', 'DECK_INSET']) {
    assert.match(above, new RegExp(`var ${name}\\s*=`), `${name} is assigned before boot() reads it`);
  }
});

// Prism nests the +/- prefix inside each diff line and gives it the same
// `inserted`/`deleted` class as the line. A rule written against those puts the
// sign on a block of its own and every line renders in two.
test('a diff tints whole lines, and does not split the sign onto its own', () => {
  const css = readFileSync(REVIEW_CSS, 'utf8');
  const block = css.slice(css.indexOf('/* A diff colours whole lines'));
  const blockEnd = block.indexOf('/* live-status');
  const diff = blockEnd > 0 ? block.slice(0, blockEnd) : block;

  const blockRules = [...diff.matchAll(/([^{}]+)\{([^}]*display:\s*block[^}]*)\}/g)].map((m) => m[1]);
  assert.ok(blockRules.length, 'the line tint is a block');
  for (const sel of blockRules) {
    assert.match(sel, /-sign/, `display:block must target the line, not the token it nests: ${sel.trim()}`);
  }
  assert.match(diff, /\.token\.prefix[^{]*\{[^}]*display:\s*inline/, 'and the sign stays inline');
});

test('the vendored highlighter is present, manual, and carries its licence', () => {
  const js = readFileSync(new URL('../server/public/prism.js', import.meta.url), 'utf8');
  assert.match(js, /manual:\s*!?0|manual:\s*true/, 'it never highlights on its own');
  assert.match(js, /MIT/, 'the upstream licence travels with the file');
  for (const lang of ['python', 'yaml', 'json', 'bash', 'sql', 'diff', 'typescript']) {
    assert.match(js, new RegExp(`--- ${lang} ---`), `${lang} grammar is built in`);
  }
});

// One rule for "what language did the author declare", checked against both
// implementations of it.
//
// There are two because there have to be: declaredLang() runs in the browser as
// ES5 in an IIFE, and renderCode() runs in Node as ESM, and nothing can be
// shared across that boundary. They were already out of step before this file
// existed. The exporter read only the <code> element's class, while the house
// rules tell authors to write `data-lang` on the <pre>, so every one of the 46
// declarations in the store was dropped on export and nothing said so.
//
// The table is the contract. Both sides answer it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { declaredOn, specToMarkdown } from '../lib/html-to-md.mjs';

const REVIEW_JS = new URL('../server/public/review.js', import.meta.url);

/**
 * Every shape an author may write, and the answer both sides owe.
 *
 * `html` is the block as authored; `lang` is what it declares, '' for nothing.
 */
const TABLE = [
  // The only shape the store actually uses: 46 of 46, measured 2026-08-15.
  { name: 'data-lang on the pre', html: '<pre data-lang="python"><code>a = 1</code></pre>', lang: 'python' },
  { name: 'data-lang on the code', html: '<pre><code data-lang="yaml">a: 1</code></pre>', lang: 'yaml' },
  { name: 'language- on the code', html: '<pre><code class="language-sql">SELECT 1</code></pre>', lang: 'sql' },
  // What import-md writes for a fenced block.
  { name: 'lang- on the code', html: '<pre><code class="lang-json">{}</code></pre>', lang: 'json' },
  { name: 'language- on the pre', html: '<pre class="language-bash"><code>ls</code></pre>', lang: 'bash' },
  { name: 'mermaid, the diagram case', html: '<pre data-lang="mermaid"><code>flowchart LR\n  A --&gt; B</code></pre>', lang: 'mermaid' },
  // Not a language. Half the store's code blocks are ASCII diagrams and
  // pseudo-code, and both sides have to leave them alone.
  { name: 'nothing declared', html: '<pre><code>users/{a} to users/{b}</code></pre>', lang: '' },
  { name: 'a class that is not a language', html: '<pre class="wide"><code>x</code></pre>', lang: '' },
  // Precedence: the innermost declaration wins, and data-lang beats the class.
  { name: 'code beats pre', html: '<pre data-lang="python"><code data-lang="yaml">a: 1</code></pre>', lang: 'yaml' },
  { name: 'data-lang beats the class on the same element', html: '<pre><code data-lang="yaml" class="language-sql">a: 1</code></pre>', lang: 'yaml' },
  // The wrapper, which the house rules document. No spec uses it today.
  { name: 'data-lang on the wrapping block', html: '<div class="codeblock" data-lang="yaml"><pre><code>a: 1</code></pre></div>', lang: 'yaml' },
  // ...and no further. declaredLang() looks at the pre's IMMEDIATE parent and
  // stops, so an intervening container ends the declaration. Without this the
  // exporter labelled every descendant of a declaring ancestor, however deep,
  // and wrote fences the review layer would then read as undeclared.
  { name: 'a wrapper does not reach past one level', html: '<div data-lang="yaml"><div class="panel"><pre><code>a: 1</code></pre></div></div>', lang: '' },
];

// ---- the Node side: what export-md writes ----

test('the exporter fences every declared language, and only those', () => {
  for (const row of TABLE) {
    const { markdown } = specToMarkdown(
      `<html><head><title>T</title></head><body><main><h1>T</h1>`
      + `<section id="s"><h2>S</h2>${row.html}</section></main></body></html>`,
      { exportedAt: '2026-08-15' },
    );
    const fence = markdown.match(/^```([\w+#-]*)$/m);
    assert.ok(fence, `${row.name}: a fence was written`);
    assert.equal(fence[1], row.lang, `${row.name}: the fence carries the declared language`);
  }
});

test('declaredOn matches the table for a single element', () => {
  assert.equal(declaredOn(' data-lang="python"'), 'python');
  assert.equal(declaredOn(' class="language-sql"'), 'sql');
  assert.equal(declaredOn(' class="lang-json"'), 'json');
  assert.equal(declaredOn(' data-lang="YAML"'), 'yaml', 'normalised, as the browser side does');
  assert.equal(declaredOn(' class="wide"'), '');
  assert.equal(declaredOn(''), '');
  assert.equal(declaredOn(' data-lang="yaml" class="language-sql"'), 'yaml', 'data-lang first');
});

// ---- the browser side: what the review layer highlights and renders ----

/**
 * Ask review.js the same question, by giving it a page and reading back which
 * language it decided each block was.
 *
 * Prism is stubbed with every grammar in the table, so a block reaching the
 * highlighter reports the language it was given. Mermaid is stubbed too, since
 * it claims its blocks before Prism sees them.
 */
async function browserAnswers(t, html) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><main>${html}</main></body></html>`, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  });
  const { window } = dom;
  t.after(() => window.close());
  window.SPECFORGE = { specId: 'test-spec', prefs: {}, transport: 'sse' };
  window.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('{"threads":[]}'),
  });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };

  // Every grammar in the table EXCEPT mermaid, because the vendored build
  // carries no mermaid grammar and that is what keeps the highlighter off a
  // diagram. Stubbing one in would test a Prism that does not exist; there is a
  // separate assertion below that the real build has none.
  const grammars = {};
  TABLE.map((r) => r.lang).filter((l) => l && l !== 'mermaid')
    .forEach((l) => { grammars[l] = {}; });
  const highlighted = [];
  window.Prism = { languages: grammars, highlightElement: (el) => highlighted.push(el) };
  window.mermaid = {
    initialize() {},
    render: (id) => Promise.resolve({ svg: `<svg id="${id}"></svg>` }),
  };

  const script = window.document.createElement('script');
  script.textContent = readFileSync(REVIEW_JS, 'utf8');
  window.document.body.appendChild(script);
  await new Promise((r) => setTimeout(r, 60));
  return { window, highlighted };
}

test('the review layer reads the same language out of the same markup', async (t) => {
  for (const row of TABLE) {
    const { window, highlighted } = await browserAnswers(t, row.html);
    const pre = window.document.querySelector('pre');

    if (row.lang === 'mermaid') {
      assert.equal(pre.getAttribute('data-sf-mermaid'), 'rendered',
        `${row.name}: claimed as a diagram, not sent to the highlighter`);
      assert.deepEqual(highlighted.map(() => 1), [], `${row.name}: and never highlighted`);
      continue;
    }

    if (!row.lang) {
      assert.deepEqual(highlighted.map(() => 1), [], `${row.name}: nothing is guessed at`);
      continue;
    }

    assert.equal(highlighted.length, 1, `${row.name}: exactly one block highlighted`);
    const cls = highlighted[0].className || '';
    assert.match(cls, new RegExp(`language-${row.lang}\\b`),
      `${row.name}: the review layer read ${row.lang}`);
  }
});

// What actually keeps the highlighter off a diagram in production. initHighlight
// runs before initMermaid, so a mermaid block IS offered to Prism; Prism declines
// it only because the vendored build has no grammar by that name. If a future
// rebuild added one, diagrams would be syntax-coloured for an instant and then
// replaced, and nothing else would notice.
test('the vendored highlighter has no mermaid grammar, which is what protects diagrams', () => {
  const prism = readFileSync(new URL('../server/public/prism.js', import.meta.url), 'utf8');
  assert.doesNotMatch(prism, /--- mermaid ---/, 'no mermaid grammar is bundled');
  assert.match(prism, /--- python ---/, 'and the check is looking at the right file');
});

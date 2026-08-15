// Rendering mermaid diagrams in the review layer.
//
// A diagram is a code block whose declared language is `mermaid`, so the
// language plumbing is the highlighter's and is not retested here. What is
// tested is the part that is specific to diagrams: rendering changes a block's
// text, and the block registry identifies a block by its text, so the order of
// those two operations and what happens when rendering fails are the whole
// design.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const REVIEW_JS = new URL('../server/public/review.js', import.meta.url);

/** A diagram that renders, and one that does not. */
const GOOD = 'flowchart LR\n  A[collector] --> B[queue]';
const BAD = 'flowchart LR\n  BOOM ][';

/**
 * Boot the review layer over `body`.
 *
 * @param {object} opts
 * @param {'ok'|'fail'|'absent'} opts.mermaid  a stub renderer that resolves, one
 *   that rejects, or none at all (standing in for a fetch that never arrives)
 * @param {boolean} opts.reconcile install a stub SFReconcile, so syncBlocks gets
 *   as far as deciding whether to write
 */
async function boot(t, body, opts = {}) {
  const { mermaid = 'ok', reconcile = false } = opts;
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  t.after(() => window.close());

  window.SPECFORGE = { specId: 'test-spec', prefs: {}, transport: 'sse' };

  const calls = [];
  window.fetch = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ registry: { schema: 1, version: 1, seq: 0, blocks: [], retired: [] } }),
      text: () => Promise.resolve('{"threads":[]}'),
    });
  };
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };

  if (reconcile) {
    window.SFReconcile = {
      reconcile: (page) => ({
        bids: page.map((_, i) => `b${i}`),
        changed: true,
        registry: { schema: 1, version: 2, seq: page.length, blocks: [], retired: [] },
      }),
    };
  }

  if (mermaid !== 'absent') {
    window.mermaid = {
      initialize() {},
      render: (id, src) => (mermaid === 'fail' || /BOOM/.test(src)
        ? Promise.reject(new Error('Parse error on line 2:\n  BOOM ]['))
        : Promise.resolve({
          svg: `<svg id="${id}"><g class="node"><text>${src.split('\n')[1].trim()}</text></g></svg>`,
        })),
    };
  }

  const script = window.document.createElement('script');
  script.textContent = readFileSync(REVIEW_JS, 'utf8');
  window.document.body.appendChild(script);
  await new Promise((r) => setTimeout(r, 60));
  return { window, calls };
}

const scriptSrcs = (window) => [...window.document.querySelectorAll('script[src]')]
  .map((s) => s.getAttribute('src'));

/**
 * Fail the renderer's fetch, the way a browser would.
 *
 * jsdom does not load external scripts unless told to, so an appended
 * `<script src>` sits there firing neither event. The browser fires `error`, and
 * that is the path worth testing, so it is dispatched here.
 */
async function failTheRendererFetch(window) {
  const s = window.document.querySelector('script[src="/public/mermaid.js"]');
  assert.ok(s, 'the renderer was requested');
  s.dispatchEvent(new window.Event('error'));
  await new Promise((r) => setTimeout(r, 40));
}

const diagram = (src, attrs = 'data-lang="mermaid"') => `<main><pre ${attrs}><code>${src}</code></pre></main>`;

// ---- what it costs a spec that has no diagram ----

test('a spec with no diagram fetches no renderer', async (t) => {
  const { window } = await boot(t, '<main><p>Prose.</p><pre><code>plain</code></pre></main>', { mermaid: 'absent' });
  assert.deepEqual(scriptSrcs(window).filter((s) => /mermaid/.test(s)), [],
    'a 3.4 MB bundle is not fetched by a spec that never asks for one');
});

test('a python block is not mistaken for a diagram', async (t) => {
  const { window } = await boot(t, '<main><pre data-lang="python"><code>a = 1</code></pre></main>', { mermaid: 'absent' });
  assert.deepEqual(scriptSrcs(window).filter((s) => /mermaid/.test(s)), []);
});

// ---- the language declaration ----

for (const [name, attrs, inner] of [
  ['data-lang on the pre', 'data-lang="mermaid"', `<code>${GOOD}</code>`],
  ['language- on the code', '', `<code class="language-mermaid">${GOOD}</code>`],
  ['lang- on the code, as markdown import writes it', '', `<code class="lang-mermaid">${GOOD}</code>`],
]) {
  test(`a diagram is recognised by ${name}`, async (t) => {
    const { window } = await boot(t, `<main><pre ${attrs}>${inner}</pre></main>`);
    assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), 'rendered');
  });
}

// ---- rendering ----

test('a rendered diagram replaces the block and is marked', async (t) => {
  const { window } = await boot(t, diagram(GOOD));
  const pre = window.document.querySelector('pre');
  assert.equal(pre.getAttribute('data-sf-mermaid'), 'rendered');
  assert.equal(pre.querySelectorAll('svg').length, 1, 'the SVG is in the block');
  assert.equal(pre.querySelectorAll('code').length, 0, 'and the source is gone from it');
});

test('the renderer is fetched once however many diagrams there are', async (t) => {
  const { window } = await boot(t, `<main>
    <pre data-lang="mermaid"><code>${GOOD}</code></pre>
    <pre data-lang="mermaid"><code>stateDiagram-v2\n  [*] --> draft</code></pre>
  </main>`, { mermaid: 'absent' });
  const srcs = scriptSrcs(window).filter((s) => /mermaid/.test(s));
  assert.deepEqual(srcs, ['/public/mermaid.js'], 'one load, served by the daemon, not a CDN');
});

// ---- the two failures, which are not the same failure ----

test('a diagram that will not parse shows the error, not the source', async (t) => {
  const { window } = await boot(t, diagram(BAD));
  const pre = window.document.querySelector('pre');
  assert.equal(pre.getAttribute('data-sf-mermaid'), 'error');
  assert.match(pre.textContent, /Diagram error: Parse error on line 2/);
  assert.doesNotMatch(pre.textContent, /BOOM/, 'the source is not left beside the error');
  assert.equal(pre.textContent.includes('\n'), false, 'one line, not a stack');
});

test('an unreachable renderer leaves the source, shown as code', async (t) => {
  const { window } = await boot(t, diagram(GOOD), { mermaid: 'absent' });
  await failTheRendererFetch(window);
  const pre = window.document.querySelector('pre');
  assert.equal(pre.getAttribute('data-sf-mermaid'), null, 'nothing was decided about this block');
  assert.match(pre.textContent, /flowchart LR/, 'the reader still gets the source');
});

// ---- what may be written to the block registry ----
//
// The distinction the whole design rests on: a page whose diagrams rendered, and
// a page whose diagrams failed to parse, both produce the same text every time
// from the same source. A page whose renderer never arrived does not, and
// recording it would retire every diagram's block id for good.

test('a settled page may write the block registry', async (t) => {
  const { calls } = await boot(t, diagram(GOOD), { reconcile: true });
  const puts = calls.filter((c) => c.method === 'PUT' && /\/blocks$/.test(c.url));
  assert.equal(puts.length, 1, 'the reconcile is persisted');
});

test('a page whose diagram failed to parse is still settled', async (t) => {
  const { calls } = await boot(t, diagram(BAD), { reconcile: true });
  const puts = calls.filter((c) => c.method === 'PUT' && /\/blocks$/.test(c.url));
  assert.equal(puts.length, 1, 'a bad source fails the same way every load, so it is safe to remember');
});

test('a page whose renderer never arrived does not write the registry', async (t) => {
  const { window, calls } = await boot(t, diagram(GOOD), { mermaid: 'absent', reconcile: true });
  await failTheRendererFetch(window);
  const puts = calls.filter((c) => c.method === 'PUT' && /\/blocks$/.test(c.url));
  assert.equal(puts.length, 0, 'writing this page would orphan every thread on a diagram');
  const gets = calls.filter((c) => c.method === 'GET' && /\/blocks$/.test(c.url));
  assert.equal(gets.length, 1, 'but it is still read, so threads resolve as they always did');
});

// The rail loads behind the renderer, so a request that neither completes nor
// fails would leave a spec with no comments rather than with no diagram. Before
// the guard, this test hung with zero requests made.
test('the comment rail still loads while the renderer is in flight or stuck', async (t) => {
  const { window, calls } = await boot(t, diagram(GOOD), { mermaid: 'absent', reconcile: true });
  assert.deepEqual(calls.filter((c) => /comments/.test(c.url)), [],
    'nothing has settled yet, so nothing has loaded yet');
  await failTheRendererFetch(window);
  assert.ok(calls.some((c) => /comments/.test(c.url)), 'the rail loads once the page settles either way');
});

test('a spec with no diagram writes the registry exactly as before', async (t) => {
  const { calls } = await boot(t, '<main><p>Prose.</p></main>', { mermaid: 'absent', reconcile: true });
  const puts = calls.filter((c) => c.method === 'PUT' && /\/blocks$/.test(c.url));
  assert.equal(puts.length, 1, '120 of 120 specs in the store take this path');
});

// ---- the boot-order trap this file has hit before ----

test('the diagram constants are declared before boot() runs', () => {
  const js = readFileSync(REVIEW_JS, 'utf8');
  const bootAt = js.indexOf("if (document.readyState !== 'loading') boot();");
  assert.ok(bootAt > 0);
  const above = js.slice(0, bootAt);
  for (const name of ['MERMAID_SRC', 'MERMAID_MAX_TEXT']) {
    assert.match(above, new RegExp(`var ${name}\\s*=`), `${name} is assigned before boot() reads it`);
  }
});

test('the reconcile is chained behind the render, not run beside it', () => {
  const js = readFileSync(REVIEW_JS, 'utf8');
  // Ordering is the invariant, and it is invisible to a DOM test that happens to
  // win the race. syncBlocks must appear only inside the initMermaid callback.
  assert.match(js, /initMermaid\(function \(settled\) \{[\s\S]{0,400}?syncBlocks\(load, settled\);/,
    'boot() calls syncBlocks from inside initMermaid, with the settled flag');
});

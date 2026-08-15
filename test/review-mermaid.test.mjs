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
  const {
    mermaid = 'ok', reconcile = false, slowRenderMs = 0, fastTimeout = false, beforeScript,
  } = opts;
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  t.after(() => window.close());

  // Shorten the renderer's load timeout by controlling the page's clock, rather
  // than by adding a production knob that exists only for a test. Only the long
  // timer is touched; the rail's own poll interval is a different function.
  if (fastTimeout) {
    const real = window.setTimeout;
    window.setTimeout = (fn, ms, ...rest) => real(fn, ms >= 10000 ? 5 : ms, ...rest);
  }

  window.SPECFORGE = { specId: 'test-spec', prefs: {}, transport: 'sse' };

  const calls = [];
  window.fetch = (url, init) => {
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch { /* not JSON */ }
    calls.push({ url: String(url), method: (init && init.method) || 'GET', body });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ registry: { schema: 1, version: 1, seq: 0, blocks: [], retired: [] } }),
      text: () => Promise.resolve('{"threads":[]}'),
    });
  };
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };

  // What the reconcile was asked about, which is the page's own idea of its
  // commentable blocks. Asserting on this beats exporting the internal function.
  const seen = [];
  if (reconcile) {
    window.SFReconcile = {
      reconcile: (page) => {
        seen.push(page);
        return {
          bids: page.map((_, i) => `b${i}`),
          changed: true,
          registry: { schema: 1, version: 2, seq: page.length, blocks: [], retired: [] },
        };
      },
    };
  }

  if (mermaid !== 'absent') {
    const answer = (id, src) => (mermaid === 'fail' || /BOOM/.test(src)
      ? Promise.reject(new Error('Parse error on line 2:\n  BOOM ]['))
      : Promise.resolve({
        svg: opts.svg ? opts.svg(id, src.split('\n')[1].trim())
          : `<svg id="${id}"><g class="node"><text>${src.split('\n')[1].trim()}</text></g></svg>`,
      }));
    window.mermaid = {
      initialize() {},
      render: (id, src) => (slowRenderMs
        ? new Promise((res, rej) => setTimeout(() => answer(id, src).then(res, rej), slowRenderMs))
        : answer(id, src)),
    };
  }

  if (beforeScript) beforeScript(window);

  const script = window.document.createElement('script');
  script.textContent = readFileSync(REVIEW_JS, 'utf8');
  window.document.body.appendChild(script);
  await new Promise((r) => setTimeout(r, 60));
  return { window, calls, reconciled: seen };
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

test('a page whose renderer never arrived does not touch the registry at all', async (t) => {
  const { window, calls } = await boot(t, diagram(GOOD), { mermaid: 'absent', reconcile: true });
  await failTheRendererFetch(window);
  const blocks = calls.filter((c) => /\/blocks$/.test(c.url));
  // Not read either, and that is the point. Reconciling populates goneBids in
  // memory whether or not the result is persisted, so an unrendered diagram's
  // stored id would read as deleted and its threads would render as orphans on
  // a page that wrote nothing. Skipping falls back to resolving by content.
  assert.deepEqual(blocks, [], 'an unsettled page is not one to learn anything from');
});

test('one diagram rendering and another not still leaves the registry alone', async (t) => {
  // The mixed page is the dangerous one: something to reconcile against, and
  // half of it not yet what it will be.
  const { window, calls } = await boot(t, `<main>
    <pre data-lang="mermaid"><code>${GOOD}</code></pre>
    <pre data-lang="mermaid"><code>${GOOD}</code></pre>
  </main>`, { mermaid: 'absent', reconcile: true, fastTimeout: true });
  await deliverRendererLate(window, 60);

  const blocks = calls.filter((c) => /\/blocks$/.test(c.url));
  assert.deepEqual(blocks, [], 'no read, no write, no orphan');
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

// ---- a render that finishes after the page gave up on it ----
//
// The load timeout exists so the comment rail is never held hostage by a request
// that neither completes nor fails. It creates a second race in exchange: the
// reconcile runs against the source text, and a render resolving afterwards
// would replace the block, leaving every comment on the page anchored to text
// that is no longer in it. So a late render is dropped.

/**
 * Deliver the renderer after the page has already given up waiting for it.
 *
 * The timer is armed when the script is appended, so this only reproduces with
 * the bundle genuinely absent at boot: install it, then fire the load event the
 * browser would have fired, and let the slow render land afterwards.
 */
async function deliverRendererLate(window, renderMs) {
  const s = window.document.querySelector('script[src="/public/mermaid.js"]');
  assert.ok(s, 'the renderer was requested');
  window.mermaid = {
    initialize() {},
    render: (id) => new Promise((res) => setTimeout(
      () => res({ svg: `<svg id="${id}"><g class="node"><text>late</text></g></svg>` }),
      renderMs,
    )),
  };
  s.dispatchEvent(new window.Event('load'));
  await new Promise((r) => setTimeout(r, renderMs + 80));
}

test('a render that lands after the page settled does not touch the block', async (t) => {
  // fastTimeout shortens the 15s load timer to 5ms, so it has already fired by
  // the time boot() returns and the renderer is delivered.
  const { window, calls } = await boot(t, diagram(GOOD), {
    mermaid: 'absent', reconcile: true, fastTimeout: true,
  });
  await deliverRendererLate(window, 60);

  const pre = window.document.querySelector('pre');
  assert.notEqual(pre.getAttribute('data-sf-mermaid'), 'rendered',
    'the block must not change after the reconcile has run against it');
  assert.match(pre.textContent, /flowchart LR/, 'it stays as its source until the next load');

  const blocks = calls.filter((c) => /\/blocks$/.test(c.url));
  assert.deepEqual(blocks, [], 'and the page that timed out is left out of the registry entirely');
});

test('a render that lands in time is applied as normal', async (t) => {
  // The other side of the same switch: slow, but with no timeout to lose to.
  const { window } = await boot(t, diagram(GOOD), { slowRenderMs: 30 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), 'rendered');
});

// ---- measuring, and what has to have arrived first ----
//
// Mermaid sizes every box around its label's measured width. A reading font is a
// web font fetched on demand, so measuring before it lands sizes each box for
// the fallback and paints in the real face: labels clipped mid-word. It survived
// the browser suite because that fixture uses no web font, and it was visible on
// the first real spec.

test('rendering waits for the page fonts', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });

  const { window } = await boot(t, diagram(GOOD), {
    beforeScript: (w) => {
      // jsdom has no document.fonts; the real thing is a promise that resolves
      // when every pending face has loaded or failed.
      Object.defineProperty(w.document, 'fonts', { value: { ready: gate }, configurable: true });
    },
  });

  assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), null,
    'nothing is measured while a font is still in flight');

  release();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), 'rendered',
    'and it renders once they have arrived');
});

test('a font that never settles does not hold the comment rail', async (t) => {
  // The rail loads behind the render, and there are two ways to wait: for the
  // script, and for the fonts. A page that already has mermaid skips the fetch,
  // so a timer armed only on the fetch path armed nothing here.
  const { window, calls } = await boot(t, diagram(GOOD), {
    reconcile: true,
    fastTimeout: true,
    beforeScript: (w) => {
      Object.defineProperty(w.document, 'fonts', {
        value: { ready: new Promise(() => {}) }, configurable: true,
      });
    },
  });
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), null,
    'the diagram never rendered, because its font never arrived');
  assert.ok(calls.some((c) => /comments/.test(c.url)),
    'but the page settled anyway and the rail loaded');
});

test('a font that never loads does not withhold the diagram', async (t) => {
  const { window } = await boot(t, diagram(GOOD), {
    beforeScript: (w) => {
      Object.defineProperty(w.document, 'fonts', {
        value: { ready: Promise.reject(new Error('font fetch failed')) }, configurable: true,
      });
    },
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(window.document.querySelector('pre').getAttribute('data-sf-mermaid'), 'rendered',
    'a rejected fonts.ready is treated as ready');
});

// ---- a diagram is one block ----
//
// Mermaid renders its labels as <p> and <span> inside a foreignObject, and <p>
// is in BLOCK_SEL. Left alone, a rendered diagram quietly becomes several
// commentable blocks: a reader clicking a node comments on a paragraph inside
// the picture, and the block registry gains an entry per label that appears and
// disappears with the render. Per-node comments are a non-goal in v1; these are
// what make that true rather than merely intended.

/** A stub SVG shaped like mermaid's: labels in a foreignObject, plus a style. */
const SVG_WITH_LABELS = (id, label) => `<svg id="${id}">`
  + `<style>#${id}{fill:#333}</style>`
  + `<g class="node"><foreignObject><div class="labelBkg"><p>${label}</p></div></foreignObject></g>`
  + '</svg>';

const bootWithLabels = (t, opts = {}) => boot(t, diagram(GOOD), { ...opts, svg: SVG_WITH_LABELS });

test('the labels inside a rendered diagram are not separate blocks', async (t) => {
  const { window, reconciled } = await bootWithLabels(t, { reconcile: true });
  const pre = window.document.querySelector('pre');
  assert.equal(pre.getAttribute('data-sf-mermaid'), 'rendered');
  assert.ok(pre.querySelector('p'), 'the fixture really does contain a <p>, as mermaid does');

  // The reconcile is handed the page's own list of commentable blocks, so this
  // is that list without exporting an internal function to see it.
  //
  // Array.from, not .filter: the array comes from the jsdom realm, and
  // deepStrictEqual compares prototypes, so even two empty arrays differ.
  assert.equal(reconciled.length, 1, 'the page reconciled once');
  const blocks = Array.from(reconciled[0], (b) => `${b.tag}:${b.text}`);
  const carrying = blocks.filter((b) => /A\[collector\]/.test(b));
  assert.equal(carrying.length, 1, 'exactly one block carries the diagram text');
  assert.match(carrying[0], /^PRE:/, 'and it is the diagram, not a paragraph inside it');
  assert.equal(blocks.filter((b) => b.startsWith('P:')).length, 0, 'no label became a block');
});

test('clicking inside a diagram puts the comment on the diagram', async (t) => {
  const { window, calls } = await bootWithLabels(t);
  const pre = window.document.querySelector('pre');
  const label = pre.querySelector('p');
  assert.ok(label, 'there is a label to click');

  // Through the real handler: a click inside the picture, then the composer.
  label.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const ta = window.document.querySelector('.sf-bub-compose textarea');
  assert.ok(ta, 'the composer opened');
  ta.value = 'Is the retry queue bounded?';
  window.document.querySelector('.sf-bub-compose .sf-primary')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const post = calls.find((c) => c.method === 'POST' && /comments$/.test(c.url));
  assert.ok(post, 'the comment was posted');
  assert.equal(post.body.anchor.block.tag, 'PRE', 'anchored to the diagram, not to a label inside it');
});

test("mermaid's stylesheet is moved out of the block", async (t) => {
  const { window } = await bootWithLabels(t);
  const pre = window.document.querySelector('pre');
  // textContent is what the registry hashes and what the rail quotes. With the
  // <style> left in, a diagram is identified by a kilobyte of generated CSS and
  // re-identifies as a different block on any mermaid upgrade.
  assert.equal(pre.querySelectorAll('style').length, 0, 'no stylesheet inside the block');
  assert.doesNotMatch(pre.textContent, /fill:#333/, 'and none of it in the block text');
  assert.equal(window.document.head.querySelectorAll('style[data-sf-mermaid-style]').length, 1,
    'it is moved rather than dropped: some of those rules are layout');
});

// ---- the palette bridge ----
//
// Its whole purpose is that a diagram re-tints with the theme. A literal colour
// in this block would look right in a screenshot and be frozen in every theme
// but the one it was picked in, which is exactly the defect the Prism mapping
// exists to avoid.

/** The mermaid section of review.css, as selector/declaration pairs. */
function mermaidRules() {
  const css = readFileSync(new URL('../server/public/review.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* mermaid diagrams');
  assert.ok(start > 0, 'the mermaid section exists');
  const block = css.slice(start, css.indexOf('/* live-status pill', start));
  assert.ok(block.length > 500, 'and it is not a stub');
  // Comments carry selectors and property names in prose; parsing them as rules
  // would flag the explanation rather than the CSS.
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), decl: m[2] }));
  assert.ok(rules.length >= 10, 'the rules are there to check');
  return rules;
}

test('every diagram colour is a palette token, so it follows the theme', () => {
  for (const { sel, decl } of mermaidRules()) {
    const literal = [...decl.matchAll(/(?:^|[\s:(])(#[0-9a-f]{3,8}\b|rgb\(|hsl\()/gi)].map((m) => m[1]);
    assert.deepEqual(literal, [], `a literal colour would not follow the theme: ${sel}`);
  }
});

test('the override is strong enough to beat mermaid, which scopes by id', () => {
  // Mermaid emits `#<id> .node rect { fill: ... }`, specificity 1-1-1. A
  // class-scoped rule loses to that, so every paint declaration aimed at
  // mermaid's own output has to say !important.
  //
  // .sf-mermaid-err is exempt and has to be: it is our element, mermaid has
  // never heard of it, and there is nothing to outrank.
  const weak = [];
  for (const { sel, decl } of mermaidRules()) {
    if (/sf-mermaid-err/.test(sel)) continue;
    for (const m of decl.matchAll(/(?:^|;)\s*(fill|stroke|background|color)\s*:\s*([^;]+)/g)) {
      if (!/!important/.test(m[2])) weak.push(`${sel} { ${m[1]}: ${m[2].trim()} }`);
    }
  }
  assert.deepEqual(weak, [], 'these would be outranked by mermaid own style block');
});

test('a rendered diagram is not still wearing the code block chrome', () => {
  const chrome = mermaidRules().find((r) => r.sel === '[data-sf-mermaid]');
  assert.ok(chrome, 'the block itself is restyled');
  for (const prop of ['background', 'border', 'padding']) {
    assert.match(chrome.decl, new RegExp(`${prop}\\s*:[^;]*!important`), `${prop} is neutralised`);
  }
});

test('the bridge sets no font, because mermaid measured with one', () => {
  // Deliberately absent, and worth asserting rather than leaving to be
  // rediscovered: a label's box is sized around its text, so overriding the
  // family afterwards draws glyphs that no longer fit. review.js tells mermaid
  // the page's real family before it measures instead.
  const forcing = mermaidRules().filter((r) => /font-family/.test(r.decl));
  assert.deepEqual(forcing.map((r) => r.sel), [],
    'no rule in the mermaid block may set font-family');
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

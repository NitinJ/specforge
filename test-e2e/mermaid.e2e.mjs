// Rendering a real diagram with the real renderer, in a real browser.
//
// test/review-mermaid.test.mjs drives a stub through jsdom and covers the
// decisions. This covers the one thing that cannot be stubbed: that the vendored
// 3.4 MB bundle actually parses this source and produces an SVG. The last defect
// of that class in this file was a `<script src="undefined">` that every jsdom
// test passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseSpec, withSpec, needsChrome } from './harness.mjs';

/** The base shell with diagrams dropped into the overview section. */
function specWith(...pres) {
  return baseSpec('Diagram spec').replace(
    '<section id="overview" data-sf-section>',
    `<section id="overview" data-sf-section>${pres.join('\n')}`,
  );
}

const FLOWCHART = `<pre data-lang="mermaid"><code>flowchart LR
  A[collector] --&gt; B{queue full?}
  B -- yes --&gt; C[retry queue]
  B -- no --&gt; D[(store)]</code></pre>`;

const BROKEN = '<pre data-lang="mermaid"><code>flowchart LR\n  A[[[ ][</code></pre>';

test('a flowchart renders to an SVG in the block it was written in', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });

    const facts = await page.evaluate(() => {
      const pre = document.querySelector('pre[data-sf-mermaid]');
      return {
        state: pre.getAttribute('data-sf-mermaid'),
        svgs: pre.querySelectorAll('svg').length,
        nodes: pre.querySelectorAll('g.node').length,
        labels: [...pre.querySelectorAll('g.node')].map((n) => n.textContent.trim()),
        sourceGone: !/flowchart LR/.test(pre.textContent),
      };
    });

    assert.equal(facts.state, 'rendered');
    assert.equal(facts.svgs, 1, 'one SVG, in the block');
    assert.equal(facts.nodes, 4, 'four nodes, as written');
    assert.deepEqual(facts.labels.sort(), ['collector', 'queue full?', 'retry queue', 'store']);
    assert.ok(facts.sourceGone, 'the source is replaced, not appended to');
  });
});

test('a diagram that will not parse shows the error and not the source', needsChrome, async () => {
  await withSpec({ html: specWith(BROKEN) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="error"]', { timeout: 30000 });
    const text = await page.locator('pre[data-sf-mermaid="error"]').innerText();
    assert.match(text, /^Diagram error: /);
    assert.doesNotMatch(text, /\[\[\[/, 'the source is not left beside the error');
  });
});

test('a spec with no diagram never fetches the renderer', needsChrome, async () => {
  await withSpec({ html: baseSpec('No diagrams') }, async ({ page }) => {
    const asked = [];
    page.on('request', (r) => { if (/mermaid\.js/.test(r.url())) asked.push(r.url()); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(1500);
    assert.deepEqual(asked, [], 'a 3.4 MB bundle is not fetched by a spec that has no diagram');
  });
});

test('the renderer is fetched once for a spec with several diagrams', needsChrome, async () => {
  const three = specWith(FLOWCHART, FLOWCHART, FLOWCHART);
  await withSpec({ html: three }, async ({ page }) => {
    await page.waitForFunction(
      () => document.querySelectorAll('pre[data-sf-mermaid="rendered"]').length === 3,
      undefined,
      { timeout: 30000 },
    );
    const count = await page.evaluate(
      () => [...document.querySelectorAll('script[src]')].filter((s) => /mermaid/.test(s.src)).length,
    );
    assert.equal(count, 1);
  });
});

test('mermaid leaves no measuring element behind on the page', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART, BROKEN) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="error"]', { timeout: 30000 });
    // Mermaid measures in a temporary element and abandons it when a render
    // throws. Left behind it is a stray block on the page and one more entry the
    // comment reconcile has to account for.
    const strays = await page.evaluate(
      () => [...document.querySelectorAll('[id^="dsf-mmd-"]')].length,
    );
    assert.equal(strays, 0);
  });
});

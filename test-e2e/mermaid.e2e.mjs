// Rendering a real diagram with the real renderer, in a real browser.
//
// test/review-mermaid.test.mjs drives a stub through jsdom and covers the
// decisions. This covers the one thing that cannot be stubbed: that the vendored
// 3.4 MB bundle actually parses this source and produces an SVG. The last defect
// of that class in this file was a `<script src="undefined">` that every jsdom
// test passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseSpec, withSpec, needsChrome, computedAcrossThemes } from './harness.mjs';

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

// ---- the palette bridge ----
//
// The claim is that a diagram re-tints with the theme without re-rendering. Only
// a browser can settle it: the CSS test proves no literal colours were written,
// which is necessary and not sufficient, because a rule that loses to mermaid's
// id-scoped style block is also token-free and also wrong.

test('a rendered node is painted from the palette, and follows a theme flip', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });

    const shape = await computedAcrossThemes(page, 'pre[data-sf-mermaid] g.node rect', 'fill');
    assert.ok(shape.changed, `node fill is frozen at ${shape.light} in both themes`);

    const label = await computedAcrossThemes(page, 'pre[data-sf-mermaid] .nodeLabel', 'color');
    assert.ok(label.changed, `node label is frozen at ${label.light} in both themes`);

    const edge = await computedAcrossThemes(page, 'pre[data-sf-mermaid] .flowchart-link', 'stroke');
    assert.ok(edge.changed, `edge stroke is frozen at ${edge.light} in both themes`);
  });
});

test('the node fill is the panel token, not a colour that merely differs', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    const same = await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      const shape = document.querySelector('pre[data-sf-mermaid] g.node rect');
      const token = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
      // Resolve the token through the same engine, so the comparison is of
      // painted values rather than of a hex string against an rgb() string.
      const probe = document.createElement('span');
      probe.style.color = token;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return { fill: getComputedStyle(shape).fill, panel: resolved };
    });
    assert.equal(same.fill, same.panel, 'the node is filled with --panel itself');
  });
});

// The assertion that would have caught both of the defects this bridge shipped
// with, and that neither the CSS test nor a per-selector check did.
//
// Both were the same mistake: naming the element a reader would name, when
// mermaid keeps the paint one level below it. The <text> of a sequence actor
// computed to --ink while the <tspan> inside it stayed #333, and the div named
// labelBkg took the background while the <p> inside it kept mermaid's pink. A
// probe aimed at a selector confirms the selector. This asks the page.
test('nothing visible in a rendered diagram is painted off-palette', needsChrome, async () => {
  const html = specWith(FLOWCHART, `<pre data-lang="mermaid"><code>sequenceDiagram
  participant Agent
  participant Daemon
  Agent-&gt;&gt;Daemon: create spec</code></pre>`);

  await withSpec({ html }, async ({ page }) => {
    await page.waitForFunction(
      () => document.querySelectorAll('pre[data-sf-mermaid="rendered"]').length === 2,
      undefined,
      { timeout: 30000 },
    );

    for (const theme of ['light', 'dark']) {
      const stray = await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);

        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const resolve = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
        const tokens = ['bg', 'panel', 'panel2', 'ink', 'muted', 'line', 'accent', 'green', 'amber', 'red', 'code']
          .map((k) => resolve(`var(--${k})`));
        probe.remove();
        const ok = new Set([...tokens, 'rgba(0, 0, 0, 0)', 'none', 'rgb(0, 0, 0)']);

        // Only what paints. defs/symbol/marker/filter/style inherit mermaid's
        // root fill and render nothing, so they are noise here.
        //
        // Each term is scoped individually: a selector list only applies the
        // prefix to its first term, so `pre[x] text, tspan` also matches every
        // tspan on the page, and this swept up the review chrome the first time.
        const PAINTS = ['text', 'tspan', 'p', 'span', 'div', 'rect', 'circle', 'polygon', 'ellipse'];
        const scoped = PAINTS.map((tag) => `pre[data-sf-mermaid] ${tag}`).join(',');
        const out = [];
        document.querySelectorAll(scoped).forEach((el) => {
          if (el.closest('defs, symbol, marker, filter, style')) return;
          const s = getComputedStyle(el);
          const bad = [];
          if (!ok.has(s.fill)) bad.push(`fill=${s.fill}`);
          if (!ok.has(s.backgroundColor)) bad.push(`background=${s.backgroundColor}`);
          if (!ok.has(s.color)) bad.push(`color=${s.color}`);
          if (!ok.has(s.stroke)) bad.push(`stroke=${s.stroke}`);
          if (bad.length) {
            out.push(`<${el.tagName}> .${el.getAttribute('class') || ''} "${(el.textContent || '').trim().slice(0, 18)}" ${bad.join(' ')}`);
          }
        });
        return out;
      }, theme);

      assert.deepEqual(stray, [], `off-palette paint in ${theme}; these will not re-theme`);
    }
  });
});

test('a rendered diagram sheds the code block chrome', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    const box = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('pre[data-sf-mermaid]'));
      return { border: s.borderTopWidth, padding: s.paddingTop, bg: s.backgroundColor };
    });
    assert.equal(box.border, '0px', 'no code-block border around a picture');
    assert.equal(box.padding, '0px');
    assert.match(box.bg, /rgba\(0, 0, 0, 0\)|transparent/, 'no code-block fill');
  });
});

test('an unrendered diagram keeps the code block chrome, because it is code', needsChrome, async () => {
  // The fallback has to look like what it is. This is what a reader sees from
  // file://, offline, or with the renderer unreachable.
  await withSpec({ html: specWith('<pre data-lang="python"><code>a = 1</code></pre>') }, async ({ page }) => {
    const box = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('pre[data-lang="python"]'));
      return { border: s.borderTopWidth, padding: s.paddingTop };
    });
    assert.notEqual(box.border, '0px', 'an ordinary code block is untouched by the diagram rules');
    assert.notEqual(box.padding, '0px');
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

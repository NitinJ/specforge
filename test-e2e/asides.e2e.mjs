// Asides, in a real browser.
//
// jsdom says the strip exists and the class flips. It cannot say whether the
// aside reads as attached to the section above it, whether folding it actually
// hides anything, or whether its colours come from the palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, baseSpec, findCachedChromium, computedAcrossThemes } from './harness.mjs';

const CHROME = findCachedChromium();

const HTML = baseSpec('Asides e2e').replace(
  '<main>',
  '<main>'
  + '<section id="target"><h2>Target</h2><p id="p">The section the aside came from.</p></section>'
  + '<section id="target-aside-1" data-sf-aside="target" data-sf-action="visualize">'
  + '<h3>Aside: Visualize</h3><p id="ap">A diagram the agent drafted.</p></section>',
);

test('the aside renders offset from the section above it', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    const geom = await page.evaluate(() => {
      const src = document.getElementById('target').getBoundingClientRect();
      const aside = document.getElementById('target-aside-1').getBoundingClientRect();
      return { srcLeft: src.left, asideLeft: aside.left, asideTop: aside.top, srcBottom: src.bottom };
    });
    assert.ok(geom.asideLeft > geom.srcLeft, 'indented, so it reads as attached rather than next');
    assert.ok(geom.asideTop >= geom.srcBottom - 1, 'and it sits below its source');
  });
});

test('folding the aside actually hides its body', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    assert.equal(await page.locator('#ap').isVisible(), true);
    await page.click('#target-aside-1 .sf-aside-toggle');
    assert.equal(await page.locator('#ap').isVisible(), false, 'hidden');
    assert.equal(await page.locator('#target-aside-1').isVisible(), true, 'the strip stays');
    await page.click('#target-aside-1 .sf-aside-toggle');
    assert.equal(await page.locator('#ap').isVisible(), true, 'and it comes back');
  });
});

test('the aside re-themes, so its colours come from the palette', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    const bg = await computedAcrossThemes(page, '#target-aside-1', 'background-color');
    assert.equal(bg.changed, true, `aside background did not move: ${bg.light} / ${bg.dark}`);
  });
});

test('Import opens the composer, anchored inside the aside', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.locator('#target-aside-1 .sf-aside-act', { hasText: 'Import' }).click();
    await page.waitForSelector('#sf-rail .sf-bub-compose textarea');
    assert.equal(
      await page.locator('#sf-rail .sf-bub-compose textarea').inputValue(),
      '@import ',
    );
  });
});

test('the aside carries no table-of-contents entry', { skip: !CHROME }, async () => {
  // It exists until the reader answers it, and the outline is the document's.
  //
  // A spec with its own nav.toc excludes asides by construction, since nothing
  // links them. This drives the OTHER path, where the drawer is built from
  // section[id] and an aside would be listed unless it is filtered out.
  const noNativeToc = `<!doctype html><html><head><title>No TOC</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}</style>
</head><body><main>
<h1>No TOC Spec</h1>
<section id="one"><h2>One</h2><p>First.</p></section>
<section id="two"><h2>Two</h2><p>Second.</p></section>
<section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize"><h3>Aside: Visualize</h3><p>Draft.</p></section>
<section id="three"><h2>Three</h2><p>Third.</p></section>
</main></body></html>`;

  await withSpec({ html: noNativeToc }, async ({ page }) => {
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('#sf-toc a')].map((a) => a.getAttribute('href')));
    assert.deepEqual(hrefs, ['#one', '#two', '#three'], 'the sections, and not the aside');
  });
});

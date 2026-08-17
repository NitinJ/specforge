// Section spacing, measured.
//
// This is the whole point of the change and no unit test can see it: the bug was
// a selector that matched more than it read as, and the symptom was a number in
// a layout. Only a browser computes that number.
//
// The correction lives in review.css rather than only in the templates, because
// a template reaches specs written after it and the ones already in the store
// carry the broken rule in their own <style>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, baseSpec, findCachedChromium } from './harness.mjs';

const CHROME = findCachedChromium();

const HTML = baseSpec('Spacing e2e').replace(
  '<main>',
  '<main>'
  + '<section id="one"><h2>1 · One</h2><p id="p1">The first section.</p></section>'
  + '<section id="two"><h2 id="h2b">2 · Two</h2><p>The second section.</p>'
  + '<h3 id="h3b">A subsection</h3><p>Under the subsection.</p>'
  + '<h4 id="h4b">A sub-subsection</h4><p>Under that.</p></section>',
);

/** The gap between the bottom of one element and the top of another. */
const gapBetween = (page, above, below) => page.evaluate(([a, b]) => {
  const top = document.getElementById(b).getBoundingClientRect().top;
  const bottom = document.getElementById(a).getBoundingClientRect().bottom;
  return Math.round(top - bottom);
}, [above, below]);

test('a section is set well clear of the one above it', { skip: !CHROME }, async () => {
  // It was 18px, from an exception meant for the first heading that matched
  // every heading. A reader called the result "little space between them".
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#h2b');
    const gap = await gapBetween(page, 'p1', 'h2b');
    assert.ok(gap >= 40, `only ${gap}px between sections`);
  });
});

test('the separator above a section is drawn, and not above the first one', { skip: !CHROME }, async () => {
  // Same broken selector removed the rule as well as the space, so a spec that
  // defines section separators has never shown one.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#h2b');
    const borders = await page.evaluate(() => ({
      first: getComputedStyle(document.querySelector('#one > h2')).borderTopWidth,
      later: getComputedStyle(document.getElementById('h2b')).borderTopWidth,
    }));
    assert.equal(borders.first, '0px', 'the first section opens the document, so no rule above it');
    assert.notEqual(borders.later, '0px', 'and every later one is separated');
  });
});

test('subsections get room too, but less than a section', { skip: !CHROME }, async () => {
  // The hierarchy has to survive the change: if an h3 is set as far from its
  // neighbour as an h2 is, the document reads as flat.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#h3b');
    const spacing = await page.evaluate(() => {
      const mt = (id) => parseFloat(getComputedStyle(document.getElementById(id)).marginTop);
      return { h2: mt('h2b'), h3: mt('h3b'), h4: mt('h4b') };
    });
    assert.ok(spacing.h3 > spacing.h4, `h3 ${spacing.h3} should exceed h4 ${spacing.h4}`);
    assert.ok(spacing.h2 > spacing.h3, `h2 ${spacing.h2} should exceed h3 ${spacing.h3}`);
    assert.ok(spacing.h4 >= 20, `h4 at ${spacing.h4}px is still tight`);
  });
});

test('a section that sets its own spacing keeps all of it, not just the heading', { skip: !CHROME }, async () => {
  // An opt-out honoured on one rule of three is a promise the stylesheet does
  // not keep: the h2 would be left alone while the h3 and h4 inside it were
  // still overwritten.
  const opted = `<!doctype html><html><head><title>Opted out</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}
body{background:var(--bg);color:var(--ink)}
section h2,section h3,section h4{margin-top:7px}</style>
</head><body><main>
<h1>Opted out</h1>
<section id="s1"><h2>One</h2><p>First.</p></section>
<section id="s2" data-sf-space><h2 id="o2">Two</h2><p>Second.</p>
<h3 id="o3">Sub</h3><p>Under.</p><h4 id="o4">Sub-sub</h4><p>Under that.</p></section>
</main></body></html>`;
  await withSpec({ html: opted }, async ({ page }) => {
    await page.waitForSelector('#o4');
    const mt = await page.evaluate(() => {
      const m = (id) => getComputedStyle(document.getElementById(id)).marginTop;
      return { h2: m('o2'), h3: m('o3'), h4: m('o4') };
    });
    assert.deepEqual(mt, { h2: '7px', h3: '7px', h4: '7px' });
  });
});

test('a deck is left alone, because it has no gaps between sections to set', { skip: !CHROME }, async () => {
  // A deck shows one section at a time and fills the stage. Section margins
  // there are meaningless at best and push a slide's own layout around at worst.
  //
  // Built on a shell that styles no headings of its own, so a margin or a rule
  // found on a slide can only have come from the injected stylesheet. Using the
  // ordinary shell here would measure that shell's own spacing and prove
  // nothing.
  const deck = `<!doctype html><html><head><title>Deck spacing e2e</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}
body{background:var(--bg);color:var(--ink)}</style>
</head><body><main>
<h1>Deck</h1>
<section id="s1" data-sf-section class="is-current"><h2>One</h2><p>First slide.</p></section>
<section id="s2" data-sf-section><h2 id="d2">Two</h2><p>Second slide.</p></section>
</main></body></html>`;
  await withSpec({ html: deck }, async ({ page }) => {
    await page.waitForSelector('#d2');
    const flagged = await page.evaluate(() => document.documentElement.hasAttribute('data-sf-deck'));
    assert.equal(flagged, true, 'the deck was detected');
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('d2'));
      return { border: s.borderTopWidth, margin: s.marginTop };
    });
    assert.equal(style.border, '0px', 'no injected separator on a slide');
    assert.notEqual(style.margin, '56px', 'and no injected section margin either');
  });
});

test('a scrolling spec on the same bare shell does get the spacing', { skip: !CHROME }, async () => {
  // The other half of the deck test: without it, a rule that never applied
  // anywhere would pass the one above.
  const plain = `<!doctype html><html><head><title>Plain spacing e2e</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}
body{background:var(--bg);color:var(--ink)}</style>
</head><body><main>
<h1>Plain</h1>
<section id="s1"><h2>One</h2><p>First section.</p></section>
<section id="s2"><h2 id="p2">Two</h2><p>Second section.</p></section>
</main></body></html>`;
  await withSpec({ html: plain }, async ({ page }) => {
    await page.waitForSelector('#p2');
    const style = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('p2'));
      return { border: s.borderTopWidth, margin: s.marginTop };
    });
    assert.equal(style.margin, '56px', 'the injected section margin applies');
    assert.notEqual(style.border, '0px', 'and so does the separator');
  });
});

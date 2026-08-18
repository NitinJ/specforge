// How deep the contents rail goes, in a real browser.
//
// jsdom says which links exist. It cannot say whether the three levels are
// visually distinguishable, which is the whole reason the rail stopped one level
// short before: a flat third level would have been worse than none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, findCachedChromium } from './harness.mjs';

const CHROME = findCachedChromium();

// A bare shell on purpose. The standard shell carries its own nav.toc, and the
// rail prefers those curated links — so sections appended to it are not in the
// outline at all and their headings are never collected. With no native TOC the
// rail builds from the sections themselves, which is the path under test.
const HTML = `<!doctype html><html><head><title>TOC depth e2e</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}
body{background:var(--bg);color:var(--ink)}</style>
</head><body><main>
<h1>TOC depth</h1>
<section id="one"><h2>1 · One</h2><p>x</p>
  <h3 id="s1">Subsection</h3><p>x</p>
  <h4 id="s1a">Sub-subsection</h4><p>x</p>
  <h5 id="s1a1">A label</h5><p>x</p></section>
<section id="two"><h2>2 · Two</h2><p>x</p></section>
<section id="three"><h2>3 · Three</h2><p>x</p></section>
</main></body></html>`;

test('the rail lists three levels and leaves the label out', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#sf-toc');
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('#sf-toc a')].map((a) => a.getAttribute('href')));
    assert.ok(hrefs.includes('#s1'), 'the subsection');
    assert.ok(hrefs.includes('#s1a'), 'the sub-subsection, which used to be unreachable');
    assert.equal(hrefs.includes('#s1a1'), false, 'the label stays out of the outline');
  });
});

test('each level is indented further than the one above it', { skip: !CHROME }, async () => {
  // Measured on where the TEXT starts, not on the link's own box. Rail links are
  // block-level and full width, so every level has the same box left however it
  // is indented — the first version of this test compared those and passed two
  // identical numbers.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#sf-toc');
    const x = await page.evaluate(() => {
      const textLeft = (sel) => {
        const el = document.querySelector(sel);
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().left;
      };
      return {
        section: textLeft('#sf-toc a[href="#one"]'),
        sub: textLeft('#sf-toc a[href="#s1"]'),
        subsub: textLeft('#sf-toc a[href="#s1a"]'),
      };
    });
    assert.ok(x.sub > x.section, `subsection text at ${x.sub} should start right of section ${x.section}`);
    assert.ok(x.subsub > x.sub, `sub-subsection text at ${x.subsub} should start right of subsection ${x.sub}`);
  });
});

test('the deepest level is legible, not just present', { skip: !CHROME }, async () => {
  // Quieter than its parent, but a rail entry nobody can read is not navigation.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('#sf-toc');
    const seen = await page.evaluate(() => {
      const el = document.querySelector('#sf-toc a[href="#s1a"]');
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { size: parseFloat(s.fontSize), opacity: parseFloat(s.opacity), w: r.width, h: r.height };
    });
    assert.ok(seen.size >= 11, `${seen.size}px is too small to read`);
    assert.ok(seen.opacity >= 0.7, `opacity ${seen.opacity} is too faint`);
    assert.ok(seen.w > 0 && seen.h > 0, 'and it actually occupies space');
  });
});

test('collapsing a section hides all of its levels, not just the first', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    // The rail auto-collapses on a window too narrow to fit it beside the
    // centred content, and the harness viewport is under that threshold — the
    // toggle is then off-screen and cannot be clicked. The other tests here read
    // the DOM and do not care; this one needs the control.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-toc');
    await page.click('#sf-toc .sf-toc-group .sf-toc-tw');
    // Wait for the state, then for the animation to finish, rather than guessing
    // at a duration: the sub-list closes by animating grid-template-rows and its
    // height is still shrinking for a few frames after the class lands.
    await page.waitForSelector('#sf-toc .sf-toc-group.sf-collapsed');
    await page.waitForFunction(() =>
      document.querySelector('#sf-toc .sf-toc-group.sf-collapsed .sf-toc-sub-in')
        .getBoundingClientRect().height === 0);

    // The links keep their own layout height — the list CLIPS them rather than
    // collapsing them, so measuring a link proves nothing. What hides them is
    // the container's height and `inert`, and both cover every level inside it.
    const state = await page.evaluate(() => {
      const group = document.querySelector('#sf-toc .sf-toc-group.sf-collapsed');
      const inner = group.querySelector('.sf-toc-sub-in').getBoundingClientRect();
      const sub = group.querySelector('.sf-toc-sub');
      const links = [...group.querySelectorAll('.sf-toc-sub a')].map((a) => a.getAttribute('href'));
      return { innerH: inner.height, inert: sub.inert === true, links };
    });
    assert.equal(state.innerH, 0, 'the sub-list is clipped to nothing');
    assert.equal(state.inert, true, 'and leaves the tab order');
    assert.deepEqual(state.links, ['#s1', '#s1a'], 'both levels were inside it, not just the first');
  });
});

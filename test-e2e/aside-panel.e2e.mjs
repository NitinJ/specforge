// The aside panel, in a real browser.
//
// jsdom says the nodes moved and the classes flipped. It cannot say whether the
// panel is on screen, whether the marker is where the eye expects it, or whether
// the document underneath is still readable while the panel is open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, baseSpec, findCachedChromium, computedAcrossThemes } from './harness.mjs';

const CHROME = findCachedChromium();

const HTML = baseSpec('Aside panel e2e').replace(
  '<main>',
  '<main>'
  + '<section id="target"><h2>Target</h2><p id="p">The section the aside came from.</p></section>'
  + '<section id="target-aside-1" data-sf-aside="target" data-sf-action="visualize">'
  + '<h3>Aside: Visualize</h3><p id="ap">A diagram the agent drafted.</p></section>',
);

/**
 * Open the panel and wait for it to finish sliding.
 *
 * The `open` class lands before the transform does, so a measurement taken on
 * the class alone catches the panel mid-slide and reads positions that are true
 * for a few frames and never again.
 */
async function openPanel(page) {
  await page.click('#target .sf-aside-mark');
  await page.waitForSelector('#sf-asides.open');
  await page.waitForFunction(() => {
    const r = document.getElementById('sf-asides').getBoundingClientRect();
    return r.right <= innerWidth + 1 && r.left < innerWidth - 40;
  });
}

test('the aside is not in the reading flow while the panel is shut', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    const state = await page.evaluate(() => {
      const aside = document.getElementById('target-aside-1');
      const ap = document.getElementById('ap');
      return {
        inMain: document.querySelector('main').contains(aside),
        rendered: ap.getBoundingClientRect().height > 0,
      };
    });
    assert.equal(state.inMain, false, 'it was moved out of the document flow');
    assert.equal(state.rendered, false, 'and the panel shows one at a time, so it is not laid out');
    assert.equal(await page.locator('#target .sf-aside-mark').isVisible(), true, 'the marker is');
  });
});

test('the marker sits at the top right of its section', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    const geom = await page.evaluate(() => {
      const s = document.getElementById('target').getBoundingClientRect();
      const m = document.querySelector('#target .sf-aside-mark').getBoundingClientRect();
      return { sTop: s.top, sRight: s.right, mTop: m.top, mRight: m.right };
    });
    assert.ok(Math.abs(geom.mTop - geom.sTop) < 30, 'near the top of the section');
    assert.ok(Math.abs(geom.mRight - geom.sRight) < 40, 'and at its right edge');
  });
});

test('the marker opens the panel and the draft becomes readable', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    assert.equal(await page.locator('#ap').isVisible(), true, 'the draft is on screen now');
    const inside = await page.evaluate(() => {
      const panel = document.getElementById('sf-asides').getBoundingClientRect();
      const aside = document.getElementById('target-aside-1').getBoundingClientRect();
      return aside.left >= panel.left - 1 && aside.right <= panel.right + 1;
    });
    assert.equal(inside, true, 'and it is inside the panel, not spilling out of it');
  });
});

test('the document is still readable beside the open panel', { skip: !CHROME }, async () => {
  // The reason for a panel rather than the flow: you read the draft against the
  // section it came from, not instead of it.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    assert.equal(await page.locator('#p').isVisible(), true, 'the source paragraph is still there');
  });
});

test('a paragraph inside the panel is a real hit target', { skip: !CHROME }, async () => {
  // Commentability is the whole reason an aside is modelled as a section, and
  // jsdom cannot tell whether something is actually clickable.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    const probe = await page.evaluate(() => {
      const ap = document.getElementById('ap');
      const b = ap.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        ok: hit === ap || ap.contains(hit),
        hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : 'null',
        box: { l: b.left, t: b.top, w: b.width, h: b.height },
      };
    });
    assert.equal(probe.ok, true, `covered by ${probe.hit}, box ${JSON.stringify(probe.box)}`);
    await page.click('#ap');
    await page.waitForSelector('#sf-rail .sf-bub-compose');
  });
});

test('the panel re-themes, so its colours come from the palette', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    const bg = await computedAcrossThemes(page, '#sf-asides', 'background-color');
    assert.equal(bg.changed, true, `panel background did not move: ${bg.light} / ${bg.dark}`);
  });
});

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
  // b2 is #p: the registry assigns bids in document order from b1, and the
  // shell's own h2 "Target" takes b1. Probed rather than assumed.
  + '<section id="target-aside-1" data-sf-aside="target" data-sf-block="b2" data-sf-action="visualize">'
  + '<p id="ap">A diagram the agent drafted.</p></section>',
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

test('the marker sits beside the block it was asked for, at the section edge', { skip: !CHROME }, async () => {
  // Was: near the top of the section. That was true when one marker stood for
  // every draft on a section; now each marker names one block.
  await withSpec({ html: HTML }, async ({ page }) => {
    const geom = await page.evaluate(() => {
      const s = document.getElementById('target').getBoundingClientRect();
      const b = document.getElementById('p').getBoundingClientRect();
      const m = document.querySelector('#target .sf-aside-mark').getBoundingClientRect();
      return { sTop: s.top, sRight: s.right, bTop: b.top, mTop: m.top, mRight: m.right };
    });
    assert.ok(Math.abs(geom.mTop - geom.bTop) < 24, 'level with its block');
    assert.ok(geom.bTop - geom.sTop > 20, 'and that block is not the top of the section');
    // Horizontal placement is its own test now: the marker moved off the section
    // edge and into the gutter, so "within 40px of the edge" no longer holds.
    assert.ok(geom.mRight > geom.sRight, 'and clear of the text rather than on it');
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

test('the composer stays on screen with the panel open, at every width', { skip: !CHROME }, async () => {
  // Shifting the rail clear of a half-viewport panel pushes it off the left edge
  // on a narrow window: an input you cannot see, which is the dead end
  // railShouldShow exists to refuse. Below 1100 the rail stays put and overlays
  // the panel instead.
  for (const width of [1600, 1280, 1100, 900, 700]) {
    await withSpec({ html: HTML }, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPanel(page);
      await page.click('#ap');
      await page.waitForSelector('#sf-rail .sf-bub-compose');
      const box = await page.evaluate(() => {
        const r = document.querySelector('#sf-rail .sf-bub-compose').getBoundingClientRect();
        return { left: r.left, right: r.right, vw: innerWidth };
      });
      assert.ok(box.left >= -1, `composer off the left edge at ${width}: left ${box.left}`);
      assert.ok(box.right <= box.vw + 1, `composer off the right edge at ${width}: right ${box.right}`);
    });
  }
});

test('markers follow their block when the layout reflows', { skip: !CHROME }, async () => {
  // Positioned by measurement, so a reflow that fires no resize event leaves
  // them pointing at the wrong paragraph. The width slider is the everyday case.
  await withSpec({ html: HTML }, async ({ page }) => {
    const offset = () => page.evaluate(() => {
      const m = document.querySelector('.sf-aside-mark').getBoundingClientRect();
      const b = document.getElementById('p').getBoundingClientRect();
      return Math.abs(m.top - b.top);
    });
    assert.ok(await offset() < 24, 'aimed at its block to begin with');

    // Narrow the content column the way the width control does, with no resize.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--maxw', '520px');
    });
    await page.waitForTimeout(300); // the ResizeObserver fires on the next frame
    assert.ok(await offset() < 24, 'still aimed at it after the column re-wrapped');
  });
});

test('the marker sits in the gutter, clear of the text and the rail', { skip: !CHROME }, async () => {
  // It used to hang off the section's own right edge, which put it against the
  // prose on a wide window. The gutter between the document and the comments
  // rail is the strip this layout already reserves for margin furniture.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('.sf-aside-mark');
    const geom = await page.evaluate(() => {
      const m = document.querySelector('.sf-aside-mark').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      return { mLeft: m.left, mRight: m.right, mW: m.width, mH: m.height, contRight: main.right, vw: innerWidth };
    });
    assert.ok(geom.mLeft >= geom.contRight, `marker overlaps the text: ${geom.mLeft} < ${geom.contRight}`);
    assert.ok(geom.mRight <= geom.vw, 'and stays inside the window');
  });
});

test('the marker is a circle, not a pill', { skip: !CHROME }, async () => {
  // A pill in a spec is a status tag, and a control borrowing that shape reads
  // as one.
  await withSpec({ html: HTML }, async ({ page }) => {
    await page.waitForSelector('.sf-aside-mark');
    const box = await page.evaluate(() => {
      const el = document.querySelector('.sf-aside-mark');
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, radius: getComputedStyle(el).borderTopLeftRadius };
    });
    assert.equal(Math.round(box.w), Math.round(box.h), `not square: ${box.w}x${box.h}`);
    assert.ok(parseFloat(box.radius) >= box.w / 2 - 1, `not round: radius ${box.radius} on ${box.w}px`);
  });
});

test('a comment on a draft sits beside the marker while the panel is shut', { skip: !CHROME }, async () => {
  // The thread anchors to a block inside the panel, and the panel is translated
  // off screen when shut, so the bubble used to land at a height unrelated to
  // the document. The marker is where the draft is from the page's point of
  // view, so that is what it lines up with.
  await withSpec({ html: HTML }, async ({ page, base, id }) => {
    await page.evaluate(async (u) => {
      await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'the arrow is backwards',
          anchor: { block: { index: 0, tag: 'P', text: 'A diagram the agent drafted.', sectionPath: ['target-aside-1'] } },
        }),
      });
    }, `${base}/api/spec/${id}/comments`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-rail .sf-bub');
    await page.waitForSelector('.sf-aside-mark');

    const gap = await page.evaluate(() => {
      const bub = document.querySelector('#sf-rail .sf-bub').getBoundingClientRect();
      const mark = document.querySelector('.sf-aside-mark').getBoundingClientRect();
      return Math.abs(bub.top - mark.top);
    });
    assert.ok(gap < 120, `the bubble is ${Math.round(gap)}px from the marker it belongs to`);
  });
});

test('the panel re-themes, so its colours come from the palette', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    const bg = await computedAcrossThemes(page, '#sf-asides', 'background-color');
    assert.equal(bg.changed, true, `panel background did not move: ${bg.light} / ${bg.dark}`);
  });
});

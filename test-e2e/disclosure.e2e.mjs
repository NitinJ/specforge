// The disclosure, in a real browser.
//
// jsdom can say the markup is right and the rail leaves it out. It cannot say
// whether the thing actually opens, whether a keyboard alone can open it,
// whether scrolling to a comment inside a closed one reaches anything, or what
// printing does — and those four are the whole component.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';
import { component } from '../components/index.mjs';

/** A spec carrying one closed disclosure with a findable line inside it. */
function specWith(extra = '') {
  return baseSpec('Disclosure').replace(
    '</main>',
    `<section id="probe"><h2>9 · Probe</h2>
       <details class="disclosure" id="d1">
         <summary>How the 61% was measured</summary>
         <p id="inside">Every spec in the store, parsed for headings.</p>
       </details>${extra}
     </section></main>`,
  );
}

test('it opens and closes on a click, with no script of its own', needsChrome, async () => {
  await withSpec({ html: specWith() }, async ({ page }) => {
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), false,
      'closed as authored');
    // checkVisibility(), not the bounding box. A closed <details> is skipped by
    // content-visibility in current engines rather than display:none'd, so its
    // content still reports a height (measured: 18px for a bare one-line
    // <details> in Chrome 149) while being invisible to a reader. The box was
    // the first thing this test asked and it was asking the wrong question.
    const vis = () => page.evaluate(() =>
      document.getElementById('inside').checkVisibility({ contentVisibilityAuto: true }));
    assert.equal(await vis(), false, 'and its content is not on the page');

    await page.click('#d1 > summary');
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), true);
    assert.equal(await vis(), true, 'open it and the content is there');
  });
});

test('a keyboard alone can operate it', needsChrome, async () => {
  // The reason this is built on <details> rather than on a div with a click
  // handler. Nothing in the component implements any of it.
  await withSpec({ html: specWith() }, async ({ page }) => {
    await page.focus('#d1 > summary');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), true,
      'Enter opens it');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), false,
      'and closes it again');
  });
});

test('the summary is a real control, not just styled text', needsChrome, async () => {
  await withSpec({ html: specWith() }, async ({ page }) => {
    const seen = await page.evaluate(() => {
      const s = document.querySelector('#d1 > summary');
      const cs = getComputedStyle(s);
      return { cursor: cs.cursor, focusable: document.activeElement !== s };
    });
    assert.equal(seen.cursor, 'pointer', 'it reads as clickable');
    await page.focus('#d1 > summary');
    const focused = await page.evaluate(() => document.activeElement.tagName);
    assert.equal(focused, 'SUMMARY', 'and it takes focus');
  });
});

test('its colours come from the theme, not from the component', needsChrome, async () => {
  await withSpec({ html: specWith() }, async ({ page }) => {
    const read = async (theme) => page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      const s = document.querySelector('#d1 > summary');
      void s.getBoundingClientRect();
      return getComputedStyle(s).color;
    }, theme);
    const light = await read('light');
    const dark = await read('dark');
    assert.notEqual(light, dark, `summary colour re-tints (${light} vs ${dark})`);
  });
});

test('scrolling to something inside a closed disclosure opens it first', needsChrome, async () => {
  // I5. A comment anchored inside a collapsed block, or a link that targets one,
  // otherwise scrolls to a box with no height and lands nowhere.
  await withSpec({ html: specWith() }, async ({ page }) => {
    const opened = await page.evaluate(() => {
      const d = document.getElementById('d1');
      if (d.open) return 'was already open';
      // The shared helper the review layer uses at every one of its scroll
      // sites; calling it directly is the unit under test.
      window.sfRevealDisclosures(document.getElementById('inside'));
      return d.open;
    });
    assert.equal(opened, true);
  });
});

test('a disclosure nested in another opens both', needsChrome, async () => {
  const html = specWith(`
    <details class="disclosure" id="outer"><summary>Outer</summary>
      <details class="disclosure" id="inner"><summary>Inner</summary>
        <p id="deep">Buried twice.</p>
      </details>
    </details>`);
  await withSpec({ html }, async ({ page }) => {
    const opened = await page.evaluate(() => {
      window.sfRevealDisclosures(document.getElementById('deep'));
      return {
        outer: document.getElementById('outer').open,
        inner: document.getElementById('inner').open,
      };
    });
    assert.equal(opened.outer, true, 'the outer one too, or the inner stays hidden');
    assert.equal(opened.inner, true);

    // Read visibility on a later frame. Toggling `open` skips the content back
    // in through content-visibility, and the engine has not recomputed it by the
    // time the same task asks — the first version of this read `false` on a
    // subtree that was already open.
    const visible = await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(
        document.getElementById('deep').checkVisibility({ contentVisibilityAuto: true }),
      )));
    }));
    assert.equal(visible, true, 'and the content is actually on the page');
  });
});

test('printing expands every disclosure and puts them back', needsChrome, async () => {
  // I6. The stamped stylesheet asks newer engines to expand via
  // ::details-content; this is the half that works wherever the layer is loaded,
  // and it must not leave the reader's document rearranged afterwards.
  await withSpec({ html: specWith() }, async ({ page }) => {
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), true,
      'open for the printer');

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), false,
      'and closed again afterwards, because printing is not an edit');
  });
});

test('one a reader opened stays open after printing', needsChrome, async () => {
  await withSpec({ html: specWith() }, async ({ page }) => {
    await page.click('#d1 > summary');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.evaluate(() => document.getElementById('d1').open), true,
      'restore puts back what the reader chose, not what the author wrote');
  });
});

test('the library page demonstrates it live', needsChrome, async () => {
  await withSpec({}, async ({ page, base }) => {
    await page.goto(`${base}/components-interactive`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-component="disclosure"]');
    const seen = await page.evaluate(() => {
      const d = document.querySelector('[data-component="disclosure"] details');
      return { present: !!d, open: d ? d.open : null };
    });
    assert.equal(seen.present, true, 'the example is a real disclosure');
    assert.equal(seen.open, false, 'shown closed, which is how an author meets it');
    assert.ok(component('disclosure'), 'and it is the registered component');
  });
});

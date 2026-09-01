// A foldable heading, in a real browser.
//
// The grouping is the part no unit test reaches: "the heading and everything
// until the next heading" is a DOM walk, and the fold is worthless if it takes
// one paragraph too few or the next entry too many.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';

const html = (cls = 'fold') => baseSpec('Fold').replace(
  '</body>',
  `<section id="log"><h2>9 · Log</h2>
     <h3 class="${cls}" id="e1">9.1 · First entry</h3>
     <p id="p1">First body.</p>
     <h4 id="h4a">A subheading inside the entry</h4>
     <table id="t1"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
     <h3 class="${cls}" id="e2" open>9.2 · Second entry</h3>
     <p id="p2">Second body.</p>
     <h3 class="${cls}" id="e3">9.3 · Third entry</h3>
     <p id="p3">Third body.</p>
   </section></body>`,
);

const visible = (page, ids) => page.evaluate((list) => list.map((id) => {
  const el = document.getElementById(id);
  return !!(el && el.getClientRects().length);
}), ids);

test('a fold takes everything under its heading and nothing under the next', needsChrome, async () => {
  // Including its own subheadings. Stopping at any heading rather than at one of
  // the same or higher level took two blocks of eight from the first entry in
  // the spec this was built for.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#e1 .sf-fold');
    const owns = await page.evaluate(() => {
      const body = document.getElementById('e1').nextElementSibling;
      return {
        cls: body.className,
        children: [...body.children].map((c) => c.id || c.tagName.toLowerCase()),
      };
    });
    assert.equal(owns.cls, 'sf-fold-body');
    assert.deepEqual(owns.children, ['p1', 'h4a', 't1']);
  });
});

test('a subheading inside a fold hides with it', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#e1 .sf-fold');
    assert.deepEqual(await visible(page, ['h4a']), [false]);
    await page.click('#e1 .sf-fold');
    assert.deepEqual(await visible(page, ['h4a']), [true]);
  });
});

test('a fold starts closed, and one marked open starts open', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#e1 .sf-fold');
    assert.deepEqual(await visible(page, ['p1', 'p2', 'p3']), [false, true, false]);
    // The headings themselves never hide: that is the whole difference from a
    // disclosure, and what keeps the outline readable.
    assert.deepEqual(await visible(page, ['e1', 'e2', 'e3']), [true, true, true]);
  });
});

test('pressing the caret opens its own entry and no other', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#e1 .sf-fold');
    await page.click('#e1 .sf-fold');
    assert.deepEqual(await visible(page, ['p1', 'p3']), [true, false]);
    assert.equal(await page.evaluate(() =>
      document.querySelector('#e1 .sf-fold').getAttribute('aria-expanded')), 'true');
    await page.click('#e1 .sf-fold');
    assert.deepEqual(await visible(page, ['p1']), [false]);
  });
});

test('a link to a folded heading opens it, so a contents entry lands on content', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#e3 .sf-fold');
    assert.deepEqual(await visible(page, ['p3']), [false]);
    await page.evaluate(() => { location.hash = '#e3'; });
    await page.waitForTimeout(150);
    assert.deepEqual(await visible(page, ['p3']), [true]);
  });
});

test('an unmarked heading is left alone, and its content stays visible', needsChrome, async () => {
  await withSpec({ html: html('') }, async ({ page }) => {
    await page.waitForSelector('#e1');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.sf-fold').length), 0);
    assert.deepEqual(await visible(page, ['p1', 'p2', 'p3']), [true, true, true]);
  });
});

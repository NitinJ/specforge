// The context menu, in a real browser.
//
// jsdom answers whether the menu opened and what it holds. It cannot answer
// whether the menu is visible, whether it lands on screen, or whether its
// colours come from the palette rather than being hard-coded, and all three are
// how this feature would ship broken while every unit test passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withSpec, baseSpec, findCachedChromium, computedAcrossThemes } from './harness.mjs';

const CHROME = findCachedChromium();

// A spec with a paragraph worth right-clicking, in a section with a real id.
const HTML = baseSpec('Context menu e2e').replace(
  '<main>',
  '<main><section id="target"><h2>Target</h2><p id="p">A paragraph to act on.</p></section>',
);

const openMenu = async (page, sel = '#p') => {
  await page.click(sel, { button: 'right' });
  await page.waitForSelector('#sf-ctx.open');
};

test('the menu opens on right-click and is actually visible', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openMenu(page);
    const menu = page.locator('#sf-ctx');
    assert.equal(await menu.isVisible(), true);
    const rows = await page.locator('#sf-ctx .sf-menu-row').allTextContents();
    assert.equal(rows.length, 10, 'the ten local entries');
    assert.match(rows[0], /Explain simply/);
    assert.match(rows[8], /Delete/);
    assert.match(rows[9], /Copy link/);
  });
});

test('the headings are visible above their entries', { skip: !CHROME }, async () => {
  // jsdom says the headings are in the DOM. Only a browser says they are legible
  // and sit above the rows they head rather than beside them.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openMenu(page);
    const heads = await page.locator('#sf-ctx .sf-menu-head').allTextContents();
    assert.deepEqual(heads, ['Understand it', 'Check it', 'Change it']);
    const geom = await page.evaluate(() => {
      const head = document.querySelector('.sf-menu-head').getBoundingClientRect();
      const row = document.querySelector('.sf-menu-row').getBoundingClientRect();
      return { headBottom: head.bottom, rowTop: row.top, headVisible: head.height > 0 };
    });
    assert.equal(geom.headVisible, true);
    assert.ok(geom.headBottom <= geom.rowTop + 1, 'the heading is above its first row');
  });
});

test('Delete removes the block from the file, through the real endpoint', { skip: !CHROME }, async () => {
  // The whole path: right-click, confirm, endpoint, and the paragraph is gone
  // from spec.html on disk while its section and neighbours are not.
  await withSpec({ html: HTML }, async ({ page, id }) => {
    await openMenu(page);
    await page.locator('#sf-ctx .sf-menu-row', { hasText: 'Delete' }).click();
    await page.locator('.sfui-dlg[open] .sfui-btn.danger').click();
    await page.waitForFunction(() => !document.getElementById('p'));

    const onDisk = readFileSync(join(process.env.SPECFORGE_HOME, 'specs', id, 'spec.html'), 'utf8');
    assert.equal(onDisk.includes('A paragraph to act on.'), false, 'gone from the file');
    assert.equal(onDisk.includes('id="target"'), true, 'its section stays');
    assert.equal(onDisk.includes('<h2>Target</h2>'), true, 'and so does the heading beside it');
  });
});

test('every row is a real hit target, not just laid out', { skip: !CHROME }, async () => {
  // The failure this catches: a menu that renders under the rail or off the
  // edge. elementFromPoint answers what a click would actually reach.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openMenu(page);
    const covered = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sf-ctx .sf-menu-row')];
      return rows.filter((r) => {
        const b = r.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !r.contains(hit) && hit !== r;
      }).length;
    });
    assert.equal(covered, 0, 'no row is covered by something else');
  });
});

test('the menu stays on screen when opened at the bottom-right corner', { skip: !CHROME }, async () => {
  // The rows that fall outside the viewport cannot be clicked at all, and the
  // menu is nine rows tall, so a right-click in the last 300px of the page is
  // the ordinary case rather than an edge one.
  await withSpec({ html: HTML }, async ({ page }) => {
    // Put the paragraph in the bottom-right corner and right-click it there.
    await page.evaluate(() => {
      const p = document.getElementById('p');
      p.style.position = 'fixed';
      p.style.right = '4px';
      p.style.bottom = '4px';
      p.style.margin = '0';
    });
    await openMenu(page);
    const fits = await page.evaluate(() => {
      const r = document.getElementById('sf-ctx').getBoundingClientRect();
      return {
        ok: r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.top >= -1 && r.left >= -1,
        r: { t: r.top, l: r.left, b: r.bottom, right: r.right, vh: innerHeight, vw: innerWidth },
      };
    });
    assert.equal(fits.ok, true, `menu outside the viewport: ${JSON.stringify(fits.r)}`);
  });
});

test('picking an action opens the composer holding it', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openMenu(page);
    await page.locator('#sf-ctx .sf-menu-row', { hasText: 'Visualize' }).click();
    await page.waitForSelector('#sf-rail .sf-bub-compose textarea');
    const value = await page.locator('#sf-rail .sf-bub-compose textarea').inputValue();
    assert.equal(value, '@visualize ');
    // Waited for rather than read straight away: the menu fades, and its
    // `visibility` flips at the tail of the transition so a closed menu is
    // unreachable by keyboard. Reading synchronously catches it mid-fade.
    await page.waitForSelector('#sf-ctx', { state: 'hidden' });
  });
});

test('right-clicking the margin opens the spec-wide menu', { skip: !CHROME }, async () => {
  // The real gesture: the content column is centred, so the margin beside it is
  // where a reader's right-click lands when they mean "the whole document".
  // jsdom cannot tell margin from content, because it has no layout.
  await withSpec({ html: HTML }, async ({ page }) => {
    const x = await page.evaluate(() => {
      const main = document.querySelector('main').getBoundingClientRect();
      return Math.max(8, Math.round(main.left / 2));
    });
    await page.mouse.move(x, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForSelector('#sf-ctx.open');
    const rows = await page.locator('#sf-ctx .sf-menu-row').allTextContents();
    assert.equal(rows.length, 3, 'the three spec-wide actions');
    assert.match(rows.join(' '), /Consistency pass/);
    assert.equal(/Tighten/.test(rows.join(' ')), false, 'and nothing block-scoped');
  });
});

test('the menu re-themes, so its colours come from the palette', { skip: !CHROME }, async () => {
  // A hard-coded background looks right in one theme and wrong in the other,
  // and a screenshot of either would pass.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openMenu(page);
    const ink = await computedAcrossThemes(page, '#sf-ctx', 'color');
    assert.equal(ink.changed, true, `#sf-ctx colour did not move: ${ink.light} / ${ink.dark}`);
  });
});

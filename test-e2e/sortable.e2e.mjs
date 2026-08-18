// The sortable table, in a real browser.
//
// The comparison is the whole component, and it is the part a unit test cannot
// reach: the rows are DOM nodes and the ordering happens by moving them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';

// Deliberately awkward: lexical order would put 1298 before 640 before 97, and
// "8 KB" before "9 KB" but after "10 KB". A spec's tables are measurements.
const ROWS = [
  ['callout', '640', '8 KB'],
  ['tag', '1298', '10 KB'],
  ['panel', '97', '9 KB'],
];

const html = (cls = 'sortable') => baseSpec('Sortable').replace(
  '</main>',
  `<section id="probe"><h2>9 · Probe</h2>
     <table class="${cls}" id="t">
       <thead><tr><th>Component</th><th>Uses</th><th>Size</th></tr></thead>
       <tbody>${ROWS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
     </table>
   </section></main>`,
);

const order = (page, col = 0) => page.evaluate((c) =>
  [...document.querySelectorAll('#t tbody tr')].map((r) => r.cells[c].textContent), col);

test('the authored order is what a reader sees first', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    assert.deepEqual(await order(page), ROWS.map((r) => r[0]));
  });
});

test('numbers sort as numbers, not as strings', needsChrome, async () => {
  // Lexically this column is 1298, 640, 97. That ordering is the reason the
  // component needs its own comparison at all.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(2)');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298']);
  });
});

test('a number with a unit still sorts as a number', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(3)');
    assert.deepEqual(await order(page, 2), ['8 KB', '9 KB', '10 KB']);
  });
});

test('text sorts as text', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(1)');
    assert.deepEqual(await order(page), ['callout', 'panel', 'tag']);
  });
});

test('a second activation reverses, a third restores what the author wrote', needsChrome, async () => {
  // The property that makes offering a sort safe: a reader can always get back
  // to the order that meant something, exactly, rather than approximately.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    const th = '#t thead th:nth-child(2)';
    await page.click(th);
    assert.deepEqual(await order(page, 1), ['97', '640', '1298'], 'ascending');
    await page.click(th);
    assert.deepEqual(await order(page, 1), ['1298', '640', '97'], 'descending');
    await page.click(th);
    assert.deepEqual(await order(page), ROWS.map((r) => r[0]), 'and back to the authored order');
  });
});

test('only one column claims the sort', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(2)');
    await page.click('#t thead th:nth-child(1)');
    const sorted = await page.evaluate(() =>
      [...document.querySelectorAll('#t thead th')].map((h) => h.getAttribute('aria-sort')));
    assert.deepEqual(sorted, ['ascending', null, null]);
  });
});

test('the header announces the sort it applied', needsChrome, async () => {
  // aria-sort is how a screen reader learns the table was reordered; without it
  // the rows simply change under the reader with no explanation.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    const th = '#t thead th:nth-child(2)';
    await page.click(th);
    assert.equal(await page.getAttribute(th, 'aria-sort'), 'ascending');
    await page.click(th);
    assert.equal(await page.getAttribute(th, 'aria-sort'), 'descending');
    await page.click(th);
    assert.equal(await page.getAttribute(th, 'aria-sort'), null, 'and stops claiming one');
  });
});

test('a keyboard alone can sort', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.focus('#t thead th:nth-child(2)');
    await page.keyboard.press('Enter');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298']);
    await page.keyboard.press(' ');
    assert.deepEqual(await order(page, 1), ['1298', '640', '97'], 'Space works too');
  });
});

test('an ordinary table is left alone', needsChrome, async () => {
  await withSpec({ html: html('') }, async ({ page }) => {
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => ({
      wired: document.querySelector('#t').hasAttribute('data-sf-sortable'),
      cursor: getComputedStyle(document.querySelector('#t thead th')).cursor,
    }));
    assert.equal(seen.wired, false, 'not wired');
    assert.notEqual(seen.cursor, 'pointer', 'and it does not pretend to be clickable');
  });
});

test('with the script blocked the table is intact and in order', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.route('**/interactive.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(300);
    assert.deepEqual(await order(page), ROWS.map((r) => r[0]), 'every row, as written');
  });
});

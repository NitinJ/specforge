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
    await page.click('#t thead th:nth-child(2) .sf-sort');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298']);
  });
});

test('a number with a unit still sorts as a number', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(3) .sf-sort');
    assert.deepEqual(await order(page, 2), ['8 KB', '9 KB', '10 KB']);
  });
});

test('text sorts as text', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(1) .sf-sort');
    assert.deepEqual(await order(page), ['callout', 'panel', 'tag']);
  });
});

test('a second activation reverses, a third restores what the author wrote', needsChrome, async () => {
  // The property that makes offering a sort safe: a reader can always get back
  // to the order that meant something, exactly, rather than approximately.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    const th = '#t thead th:nth-child(2)';
    const btn = `${th} .sf-sort`;
    await page.click(btn);
    assert.deepEqual(await order(page, 1), ['97', '640', '1298'], 'ascending');
    await page.click(btn);
    assert.deepEqual(await order(page, 1), ['1298', '640', '97'], 'descending');
    await page.click(btn);
    assert.deepEqual(await order(page), ROWS.map((r) => r[0]), 'and back to the authored order');
  });
});

test('only one column claims the sort', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(2) .sf-sort');
    await page.click('#t thead th:nth-child(1) .sf-sort');
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
    const btn = `${th} .sf-sort`;
    await page.click(btn);
    assert.equal(await page.getAttribute(th, 'aria-sort'), 'ascending');
    await page.click(btn);
    assert.equal(await page.getAttribute(th, 'aria-sort'), 'descending');
    await page.click(btn);
    assert.equal(await page.getAttribute(th, 'aria-sort'), null, 'and stops claiming one');
  });
});

test('a keyboard alone can sort', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.focus('#t thead th:nth-child(2) .sf-sort');
    await page.keyboard.press('Enter');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298']);
    await page.keyboard.press(' ');
    assert.deepEqual(await order(page, 1), ['1298', '640', '97'], 'Space works too');
  });
});

test('the header stays a column header, and the control is a button inside it', needsChrome, async () => {
  // role="button" on the th overrides its native `columnheader`, which loses the
  // association between the header and the cells below it and makes aria-sort
  // meaningless: that attribute is defined on a header, not on a button. The
  // ARIA authoring practices' own sortable-table example nests the button.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    const seen = await page.evaluate(() => {
      const th = document.querySelector('#t thead th:nth-child(2)');
      const btn = th.querySelector('.sf-sort');
      return {
        thRole: th.getAttribute('role'),
        thTabIndex: th.getAttribute('tabindex'),
        hasButton: !!btn && btn.tagName === 'BUTTON',
        label: btn ? btn.textContent.trim() : null,
      };
    });
    assert.equal(seen.thRole, null, 'the th claims no role of its own');
    assert.equal(seen.thTabIndex, null, 'and is not itself a tab stop');
    assert.equal(seen.hasButton, true, 'the control is a real button');
    assert.equal(seen.label, 'Uses', 'carrying the header text');
  });
});

test('returning to a column starts at ascending, not where it left off', needsChrome, async () => {
  // The cycle was held per column, so sorting A, then B, then A resumed A's old
  // position and jumped straight to descending — a reader coming back to a
  // column got the opposite of what one click gives everywhere else.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    await page.click('#t thead th:nth-child(2) .sf-sort');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298'], 'B ascending');

    await page.click('#t thead th:nth-child(1) .sf-sort');
    assert.deepEqual(await order(page), ['callout', 'panel', 'tag'], 'A ascending');

    await page.click('#t thead th:nth-child(2) .sf-sort');
    assert.deepEqual(await order(page, 1), ['97', '640', '1298'],
      'back on B: ascending again, not descending');
  });
});

test('an ordinary table is left alone', needsChrome, async () => {
  await withSpec({ html: html('') }, async ({ page }) => {
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(300);
    // Asserted on the button, not on the th's cursor: the cursor moved onto the
    // button when the control stopped being the cell, so a th-cursor check would
    // now pass on a table that HAD been wired.
    const seen = await page.evaluate(() => ({
      wired: document.querySelector('#t').hasAttribute('data-sf-sortable'),
      control: !!document.querySelector('#t thead .sf-sort'),
      headerText: document.querySelector('#t thead th').textContent.trim(),
    }));
    assert.equal(seen.wired, false, 'not wired');
    assert.equal(seen.control, false, 'no control was added');
    assert.equal(seen.headerText, 'Component', 'and the header is untouched');
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

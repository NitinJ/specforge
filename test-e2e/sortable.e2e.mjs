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

test('a header that already holds a control keeps it, and stays unsorted', needsChrome, async () => {
  // Moving a link inside the sort button would nest interactive content, which
  // is invalid and unreachable by keyboard, and every press of the inner control
  // would also sort the table. An author who put a control in a header meant it
  // to do its own job.
  const withLink = baseSpec('Linked').replace('</main>',
    '<section id="p"><h2>9 · P</h2><table class="sortable" id="tl">'
    + '<thead><tr><th>Component</th>'
    + '<th>Uses <a href="#p">why</a></th>'
    + '<th>Size <details><summary>?</summary>on disk</details></th></tr></thead>'
    + '<tbody><tr><td>callout</td><td>640</td><td>8 KB</td></tr>'
    + '<tr><td>tag</td><td>1298</td><td>10 KB</td></tr></tbody></table></section></main>');
  await withSpec({ html: withLink }, async ({ page }) => {
    await page.waitForSelector('#tl[data-sf-sortable]');
    const seen = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#tl thead th')];
      return {
        plainWrapped: !!heads[0].querySelector('.sf-sort'),
        linkWrapped: !!heads[1].querySelector('.sf-sort'),
        summaryWrapped: !!heads[2].querySelector('.sf-sort'),
        linkSurvives: !!heads[1].querySelector('a[href]'),
        summarySurvives: !!heads[2].querySelector('summary'),
        nested: heads.some((h) => !!h.querySelector('.sf-sort a[href], .sf-sort summary')),
      };
    });
    assert.equal(seen.plainWrapped, true, 'the ordinary header is still sortable');
    assert.equal(seen.linkWrapped, false, 'the one with a link is not wrapped');
    assert.equal(seen.summaryWrapped, false, 'nor the one with a disclosure');
    assert.equal(seen.linkSurvives, true, 'and its link is untouched');
    assert.equal(seen.summarySurvives, true, 'and so is its summary');
    assert.equal(seen.nested, false, 'nothing interactive was nested inside a button');
  });
});

// A column index counts cells, not grid columns, so a single span anywhere puts
// the header and the cells below it out of step. Every shape here would have
// reordered the rows on a column the reader did not ask for, with nothing on the
// page to say so.
const SPANS = {
  'a spanning cell in the body': '<table class="sortable" id="t">'
    + '<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>'
    + '<tbody><tr><td colspan="2">merged</td><td>9</td></tr>'
    + '<tr><td>x</td><td>1</td><td>2</td></tr></tbody></table>',
  'a spanning header cell': '<table class="sortable" id="t">'
    + '<thead><tr><th colspan="2">Measured</th><th>C</th></tr></thead>'
    + '<tbody><tr><td>x</td><td>1</td><td>2</td></tr>'
    + '<tr><td>y</td><td>3</td><td>4</td></tr></tbody></table>',
  'a rowspan': '<table class="sortable" id="t">'
    + '<thead><tr><th>A</th><th>B</th></tr></thead>'
    + '<tbody><tr><td rowspan="2">grouped</td><td>1</td></tr>'
    + '<tr><td>2</td></tr></tbody></table>',
  'a two-row header': '<table class="sortable" id="t">'
    + '<thead><tr><th>A</th><th>B</th></tr><tr><th>n</th><th>KB</th></tr></thead>'
    + '<tbody><tr><td>x</td><td>1</td></tr><tr><td>y</td><td>2</td></tr></tbody></table>',
  'a second tbody': '<table class="sortable" id="t">'
    + '<thead><tr><th>A</th><th>B</th></tr></thead>'
    + '<tbody><tr><td>x</td><td>1</td></tr></tbody>'
    + '<tbody><tr><td>y</td><td>2</td></tr></tbody></table>',
};

for (const [shape, table] of Object.entries(SPANS)) {
  test(`${shape} leaves the table unsorted rather than sorted wrong`, needsChrome, async () => {
    const page1 = baseSpec('Spans').replace('</main>',
      `<section id="p"><h2>9 · P</h2>${table}</section></main>`);
    await withSpec({ html: page1 }, async ({ page }) => {
      await page.waitForSelector('#sf-launcher');
      await page.waitForTimeout(300);
      const seen = await page.evaluate(() => ({
        wired: document.querySelector('#t').hasAttribute('data-sf-sortable'),
        control: !!document.querySelector('#t .sf-sort'),
        rows: [...document.querySelectorAll('#t tbody tr')].map((r) => r.textContent.trim()),
      }));
      assert.equal(seen.wired, false, 'not wired');
      assert.equal(seen.control, false, 'and offers no control it cannot honour');
      assert.ok(seen.rows.length, 'the rows are still there');
    });
  });
}

test('a row with fewer cells is short at the END, and still sorts under its header', needsChrome, async () => {
  // The reason the guard tests spans and not row widths. Once colspan and
  // rowspan are excluded there is no way to write a row that SKIPS a column:
  // cells fill successive grid slots, so cell index is grid column index and a
  // short row is missing its last columns. Asserted on the geometry as well as
  // the ordering, because that is the claim the guard rests on.
  const ragged = baseSpec('Ragged').replace('</main>',
    '<section id="p"><h2>9 · P</h2><table class="sortable" id="t">'
    + '<thead><tr><th>Component</th><th>Uses</th><th>Size</th></tr></thead>'
    + '<tbody><tr><td>tag</td><td>1298</td><td>10 KB</td></tr>'
    + '<tr><td>panel</td><td>97</td></tr>'
    + '<tr><td>callout</td><td>640</td><td>8 KB</td></tr></tbody>'
    + '</table></section></main>');
  await withSpec({ html: ragged }, async ({ page }) => {
    await page.waitForSelector('#t[data-sf-sortable]');
    const aligned = await page.evaluate(() => {
      const head = document.querySelectorAll('#t thead th');
      const short = [...document.querySelectorAll('#t tbody tr')].find((r) => r.cells.length === 2);
      return Math.abs(short.cells[1].getBoundingClientRect().left
        - head[1].getBoundingClientRect().left) < 1;
    });
    assert.equal(aligned, true, 'the last cell of a short row sits in its own column');

    await page.click('#t thead th:nth-child(2) .sf-sort');
    assert.deepEqual(await order(page), ['panel', 'callout', 'tag'], '97, 640, 1298');
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

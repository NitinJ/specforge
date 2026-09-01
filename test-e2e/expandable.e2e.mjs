// The expandable table, in a real browser.
//
// Two of its three claims can only be checked by laying the page out: that an
// opened detail does not widen the table it sits in, and that a document with no
// script running still shows every detail. Both are width and visibility
// questions, and neither survives a DOM-only test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';

// The detail carries a line no soft-wrap point can break in a 3-column table.
// A cell sized by its content would take the table with it, which is the defect
// the wrapper exists to prevent.
const LONG = 'Confirmed on 2026-08-30 against the running admin, recorded in the '
  + 'Partner Dashboard, and left unstarted because the reviewer had not replied yet.';

const html = (cls = 'expandable') => baseSpec('Expandable').replace(
  '</main>',
  `<section id="probe"><h2>9 · Probe</h2>
     <table class="${cls}" id="t">
       <thead><tr><th>ID</th><th>Asset</th><th>Status</th></tr></thead>
       <tbody>
         <tr data-sf-row="a1"><td>A1</td><td>Feature video</td><td>pending</td></tr>
         <tr data-sf-detail="a1"><td colspan="3"><p>${LONG}</p></td></tr>
         <tr data-sf-row="a2"><td>A2</td><td>Listing rewrite</td><td>done</td></tr>
         <tr data-sf-detail="a2"><td colspan="3"><p>Second detail.</p></td></tr>
         <tr><td>A3</td><td>Unpaired</td><td>done</td></tr>
       </tbody>
     </table>
   </section></main>`,
);

const chevrons = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#t .sf-expand')].map((b) => b.getAttribute('aria-expanded')));

const shown = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#t tr[data-sf-detail]')].map((r) => !r.hidden));

test('every paired row gets a control and every detail starts closed', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t .sf-expand');
    assert.deepEqual(await chevrons(page), ['false', 'false']);
    assert.deepEqual(await shown(page), [false, false]);
  });
});

test('a row with no detail gets no control', needsChrome, async () => {
  // A chevron that expands nothing is worse than no chevron: it is a promise the
  // table cannot keep.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t .sf-expand');
    const third = await page.evaluate(() =>
      !!document.querySelectorAll('#t tbody tr')[4].querySelector('.sf-expand'));
    assert.equal(third, false);
  });
});

test('pressing one control opens one detail and leaves the other closed', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t .sf-expand');
    await page.click('#t tr[data-sf-row="a1"] .sf-expand');
    assert.deepEqual(await shown(page), [true, false]);
    assert.deepEqual(await chevrons(page), ['true', 'false']);
    await page.click('#t tr[data-sf-row="a1"] .sf-expand');
    assert.deepEqual(await shown(page), [false, false]);
  });
});

test('an open detail does not widen the table', needsChrome, async () => {
  // The claim the wrapper is there for. A max-width on the cell would not hold:
  // under table-layout:auto a cell is sized by its content.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t .sf-expand');
    const before = await page.evaluate(() => document.getElementById('t').getBoundingClientRect().width);
    await page.click('#t tr[data-sf-row="a1"] .sf-expand');
    const after = await page.evaluate(() => {
      const t = document.getElementById('t');
      const cell = t.querySelector('tr[data-sf-detail="a1"] td');
      return {
        width: t.getBoundingClientRect().width,
        wrapped: !!cell.querySelector(':scope > .sf-detail-body'),
        cellClientW: cell.clientWidth,
        cellScrollW: cell.scrollWidth,
        docScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert.equal(after.wrapped, true, 'the detail body is wrapped so the CSS can constrain it');
    assert.equal(Math.round(after.width), Math.round(before), 'the table is the width it was');
    assert.ok(after.cellScrollW <= after.cellClientW + 1,
      `the detail fits its cell, got ${after.cellScrollW} in ${after.cellClientW}`);
    assert.equal(after.docScrolls, false, 'and the page does not scroll sideways');
  });
});

test('a table the author did not mark is left alone', needsChrome, async () => {
  await withSpec({ html: html('') }, async ({ page }) => {
    await page.waitForSelector('#t');
    await page.waitForTimeout(200);
    const controls = await page.evaluate(() => document.querySelectorAll('#t .sf-expand').length);
    assert.equal(controls, 0);
    // And the details stay visible, because nothing enhanced them.
    assert.deepEqual(await shown(page), [true, true]);
  });
});

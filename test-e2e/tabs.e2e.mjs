// Tabs, in a real browser.
//
// The component is a reduction of a document that is already complete, so the
// two questions that matter are both about what a reader can reach: everything
// when the script does not run, and exactly one thing plus a way to the rest
// when it does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';
import { LIVE_ATTR } from '../components/index.mjs';

const PANELS = [
  ['macOS', 'brew install specforge'],
  ['Linux', 'npm i -g specforge'],
  ['Windows', 'winget install specforge'],
];

const html = () => baseSpec('Tabs').replace(
  '</main>',
  `<section id="probe"><h2>9 · Probe</h2>
     <div class="tabs" id="t1">
       ${PANELS.map(([l, c]) => `<div class="tab" data-label="${l}"><p>${c}</p></div>`).join('\n')}
     </div>
   </section></main>`,
);

const visible = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#t1 > .tab')]
    .filter((p) => p.checkVisibility({ contentVisibilityAuto: true }))
    .map((p) => p.textContent.trim()));

test('with the script blocked, every panel is on the page in order', needsChrome, async () => {
  // The whole reason this component is allowed to exist. A spec read from disk,
  // or served where the script fails, is longer and complete.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.route('**/interactive.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(400);

    assert.equal(await page.evaluate((a) => document.documentElement.hasAttribute(a), LIVE_ATTR),
      false, 'never went live');
    assert.deepEqual(await visible(page), PANELS.map(([, c]) => c), 'all three, in order');
    assert.equal(await page.evaluate(() => !!document.querySelector('.sf-tablist')), false,
      'and no strip, because nothing built one');
  });
});

test('the label is readable with no script', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.route('**/interactive.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    const label = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#t1 > .tab'), '::before').content);
    assert.match(label, /macOS/, 'drawn from data-label by CSS alone');
  });
});

test('once live, one panel shows and a strip offers the rest', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    assert.deepEqual(await visible(page), [PANELS[0][1]], 'the first only');
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('#t1 .sf-tab')].map((b) => b.textContent));
    assert.deepEqual(labels, PANELS.map(([l]) => l), 'every alternative is offered');
  });
});

test('clicking a label switches the panel', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.click('#t1 .sf-tab:nth-child(2)');
    assert.deepEqual(await visible(page), [PANELS[1][1]]);
  });
});

test('selection lands in the URL and survives a reload', needsChrome, async () => {
  // D7. No stored reader state, a working back button, and a reload during
  // review that lands where the reviewer was rather than back at panel one.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.click('#t1 .sf-tab:nth-child(3)');
    const hash = await page.evaluate(() => location.hash);
    assert.match(hash, /windows/i, `the fragment names the panel (${hash})`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#t1 .sf-tablist');
    assert.deepEqual(await visible(page), [PANELS[2][1]], 'and it opens there');
  });
});

test('switching does not scroll the page', needsChrome, async () => {
  // history.replaceState rather than assigning location.hash, which would jump
  // the panel to the top of the viewport and yank the page out from under a
  // reader who only wanted a different tab.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    // Bring the strip into view and let the scroll settle FIRST. page.click()
    // scrolls to its target on its own, so measuring across the click would
    // record Playwright's scroll and blame the component for it — which is
    // exactly what the first version of this test did (0 → 2067).
    await page.locator('#t1 .sf-tab').nth(1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.scrollY);
    await page.click('#t1 .sf-tab:nth-child(2)');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.scrollY);
    assert.equal(after, before, `the page stayed put (${before} → ${after})`);
  });
});

test('arrow keys move between tabs, and Tab does not', needsChrome, async () => {
  // The roving tabindex the ARIA tabs pattern specifies: one stop in the tab
  // order for the whole strip, arrows to move within it.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.focus('#t1 .sf-tab:nth-child(1)');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await visible(page), [PANELS[1][1]], 'right moves on');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Linux',
      'and focus follows');

    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await visible(page), [PANELS[0][1]], 'left moves back');

    const stops = await page.evaluate(() =>
      [...document.querySelectorAll('#t1 .sf-tab')].map((b) => b.tabIndex));
    assert.deepEqual(stops, [0, -1, -1], 'only the selected tab is a tab stop');
  });
});

test('arrows wrap at both ends', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.focus('#t1 .sf-tab:nth-child(1)');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await visible(page), [PANELS[2][1]], 'left from the first reaches the last');
  });
});

test('the strip carries the roles a screen reader needs', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    const seen = await page.evaluate(() => {
      const strip = document.querySelector('#t1 .sf-tablist');
      const first = strip.children[0];
      const panel = document.getElementById(first.getAttribute('aria-controls'));
      return {
        list: strip.getAttribute('role'),
        tab: first.getAttribute('role'),
        selected: first.getAttribute('aria-selected'),
        controlsResolves: !!panel,
        panelRole: panel ? panel.getAttribute('role') : null,
      };
    });
    assert.deepEqual(seen, {
      list: 'tablist', tab: 'tab', selected: 'true',
      controlsResolves: true, panelRole: 'tabpanel',
    });
  });
});

test('scrolling to something in a hidden panel opens that panel', needsChrome, async () => {
  // I5, for the other container. A comment anchored in a panel nobody selected
  // otherwise scrolls to an element with no box.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    const opened = await page.evaluate(() => {
      const target = document.querySelectorAll('#t1 > .tab')[2].querySelector('p');
      window.sfRevealDisclosures(target); // the shared entry point every scroll site uses
      return [...document.querySelectorAll('#t1 > .tab')].map((p) => !p.hidden);
    });
    assert.deepEqual(opened, [false, false, true], 'the third panel is the one showing');
  });
});

test('a group with one panel is left alone', needsChrome, async () => {
  // One alternative is not a choice, and a strip with a single label is chrome
  // that explains nothing.
  const one = baseSpec('One').replace('</main>',
    '<section id="p"><h2>9 · P</h2><div class="tabs" id="t2">'
    + '<div class="tab" data-label="Only"><p>just this</p></div></div></section></main>');
  await withSpec({ html: one }, async ({ page }) => {
    await page.waitForFunction((a) => document.documentElement.hasAttribute(a), LIVE_ATTR);
    assert.equal(await page.evaluate(() => !!document.querySelector('#t2 .sf-tablist')), false);
    assert.equal(await page.evaluate(() =>
      document.querySelector('#t2 > .tab').checkVisibility({ contentVisibilityAuto: true })),
    true, 'and its content is on the page');
  });
});

test('printing shows every panel', needsChrome, async () => {
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.emulateMedia({ media: 'print' });
    assert.deepEqual(await visible(page), PANELS.map(([, c]) => c),
      'a printed spec is not shorter than the document');
    await page.emulateMedia({ media: 'screen' });
  });
});

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
  // D7. No stored reader state, a deep-linkable panel, and a reload during
  // review that lands where the reviewer was rather than back at panel one.
  // Deliberately NOT a back-button test: replaceState does not create history
  // entries, which is the trade taken to avoid both a scroll on every switch and
  // a dozen history entries nobody asked for.
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

test('the keyboard updates the fragment too, not only the click', needsChrome, async () => {
  // They went through different paths, so arrowing to a panel and reloading put
  // the reader back on whichever one was last CLICKED. Both go through one
  // entry point now.
  await withSpec({ html: html() }, async ({ page }) => {
    await page.waitForSelector('#t1 .sf-tablist');
    await page.focus('#t1 .sf-tab:nth-child(1)');
    await page.keyboard.press('ArrowRight');
    assert.match(await page.evaluate(() => location.hash), /linux/i);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#t1 .sf-tablist');
    assert.deepEqual(await visible(page), [PANELS[1][1]], 'and the reload agrees');
  });
});

test('a malformed fragment does not stop later groups being built', needsChrome, async () => {
  // decodeURIComponent throws on a lone `%`. Thrown from inside the group loop
  // it aborted initTabs part-way, so a URL somebody pasted broke every tab group
  // below it.
  const two = html().replace('</main>',
    '<section id="p2"><h2>10 · Second</h2><div class="tabs" id="t2">'
    + '<div class="tab" data-label="A"><p>alpha</p></div>'
    + '<div class="tab" data-label="B"><p>beta</p></div></div></section></main>');
  await withSpec({ html: two }, async ({ page, base, id }) => {
    await page.goto(`${base}/spec/${id}#%E0%A4%A`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#t2 .sf-tablist');
    assert.ok(await page.evaluate(() => !!document.querySelector('#t1 .sf-tablist')),
      'the first group built');
    assert.ok(await page.evaluate(() => !!document.querySelector('#t2 .sf-tablist')),
      'and so did the one after it');
  });
});

test('panel ids do not collide with an id the author already used', needsChrome, async () => {
  // A collision points a deep link and an aria-controls at the wrong element,
  // which is worse than an ugly id.
  const clash = baseSpec('Clash').replace('</main>',
    '<section id="p"><h2>9 · P</h2>'
    + '<p id="tab-1-macos">an element that got there first</p>'
    + '<div class="tabs" id="t3">'
    + '<div class="tab" data-label="macOS"><p>alpha</p></div>'
    + '<div class="tab" data-label="Linux"><p>beta</p></div></div></section></main>');
  await withSpec({ html: clash }, async ({ page }) => {
    await page.waitForSelector('#t3 .sf-tablist');
    const seen = await page.evaluate(() => {
      const panel = document.querySelectorAll('#t3 > .tab')[0];
      const btn = document.querySelector('#t3 .sf-tab');
      return {
        panelId: panel.id,
        controls: btn.getAttribute('aria-controls'),
        resolvesToPanel: document.getElementById(btn.getAttribute('aria-controls')) === panel,
      };
    });
    assert.notEqual(seen.panelId, 'tab-1-macos', 'it stepped around the taken id');
    assert.equal(seen.resolvesToPanel, true, 'and aria-controls points at the panel');
  });
});

test('an authored id is kept, and a duplicated one is not', needsChrome, async () => {
  // An authored id is a contract with whatever links to it, so it stands. A
  // DUPLICATED authored id is not an identity at all: getElementById answers
  // with the first, so the fragment restores the wrong panel and every
  // aria-controls pointing there resolves somewhere else.
  const authored = baseSpec('Authored').replace('</main>',
    '<section id="p"><h2>9 · P</h2><div class="tabs" id="t4">'
    + '<div class="tab" id="mine" data-label="A"><p>alpha</p></div>'
    + '<div class="tab" id="mine" data-label="B"><p>beta</p></div>'
    + '<div class="tab" id="unique-one" data-label="C"><p>gamma</p></div>'
    + '</div></section></main>');
  await withSpec({ html: authored }, async ({ page }) => {
    await page.waitForSelector('#t4 .sf-tablist');
    const seen = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('#t4 > .tab')];
      const btns = [...document.querySelectorAll('#t4 .sf-tab')];
      return {
        ids: panels.map((p) => p.id),
        resolve: btns.map((b, i) =>
          document.getElementById(b.getAttribute('aria-controls')) === panels[i]),
      };
    });
    assert.equal(seen.ids[2], 'unique-one', 'a unique authored id is left alone');
    assert.notEqual(seen.ids[0], seen.ids[1], 'the duplicate was resolved');
    assert.deepEqual(seen.resolve, [true, true, true],
      'every control points at its own panel');
  });
});

test('an id full of CSS punctuation neither throws nor is misread', needsChrome, async () => {
  // The uniqueness check used to build a `[id="…"]` selector. An id may contain
  // almost anything, and a selector built from one with a backslash or a bracket
  // in it either matches the wrong element or throws — and a throw would abort
  // initTabs part-way, leaving every later group unbuilt.
  const odd = baseSpec('Odd').replace('</main>',
    '<section id="p"><h2>9 · P</h2>'
    + '<div class="tabs" id="t5">'
    + '<div class="tab" id="a[1]:x" data-label="A"><p>alpha</p></div>'
    + '<div class="tab" id="b\\c" data-label="B"><p>beta</p></div>'
    + '</div>'
    + '<div class="tabs" id="t6">'
    + '<div class="tab" data-label="C"><p>gamma</p></div>'
    + '<div class="tab" data-label="D"><p>delta</p></div>'
    + '</div></section></main>');
  await withSpec({ html: odd }, async ({ page }) => {
    await page.waitForSelector('#t6 .sf-tablist');
    const seen = await page.evaluate(() => ({
      first: [...document.querySelectorAll('#t5 > .tab')].map((p) => p.id),
      laterGroupBuilt: !!document.querySelector('#t6 .sf-tablist'),
    }));
    assert.deepEqual(seen.first, ['a[1]:x', 'b\\c'], 'the odd ids are unique, so they stand');
    assert.equal(seen.laterGroupBuilt, true, 'and the group after them was still built');
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
    // And the URL follows, because revealing a panel to read a comment in it is
    // a selection. Without this a reload took the reviewer back to whichever
    // panel was last clicked rather than the one they were reading.
    assert.match(await page.evaluate(() => location.hash), /windows/i);
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

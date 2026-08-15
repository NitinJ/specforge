// End-to-end tests for the review layer in a real browser. These cover what
// jsdom cannot: layout (the SpecForge launcher menu is the single floating
// control and is clickable) and the full comment round-trip driven through real
// clicks + the HTTP API. Run with `npm run test:e2e`.
//
// The store, the server and the browser all come from ./harness.mjs. This file
// used to boot them itself through `server/app.mjs` and `lib/paths.mjs`, which
// the v2 store replaced; nothing noticed, because the suite is not part of
// `npm test` and an import error reads as one failing file.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withSpec, needsChrome } from './harness.mjs';

test('the launcher is the single floating control, is clickable, and opens the menu with the review rows', needsChrome, async () => {
  await withSpec({}, async ({ page }) => {
    assert.equal(await page.locator('#sf-launcher').count(), 1, 'exactly one launcher');
    assert.equal(await page.locator('#sf-sidebar').count(), 1, 'exactly one sidebar');
    // The spec no longer ships its own theme/width controls — those are gone.
    assert.equal(await page.locator('#themeToggle').count(), 0, 'spec has no theme toggle');
    assert.equal(await page.locator('#sf-toggle, #sf-width, #sf-toc-toggle').count(), 0, 'no retired standalone controls');
    // The review command bar lives as a footer on the sidebar (filter + lifecycle action).
    assert.equal(await page.locator('#sf-sidebar .sf-side-foot .sf-act').count(), 1, 'sidebar footer carries the lifecycle action');

    // The launcher is the top hit-target at its own center (nothing overlaps it).
    const clickable = await page.evaluate(() => {
      const el = document.getElementById('sf-launcher');
      const b = el.getBoundingClientRect();
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return h === el || el.contains(h);
    });
    assert.ok(clickable, 'launcher is the top hit-target at its center');

    // Clicking it opens the popover menu carrying Width + Theme controls.
    assert.equal(await page.locator('#sf-menu.open').count(), 0, 'menu starts closed');
    await page.locator('#sf-launcher').click();
    await page.waitForSelector('#sf-menu.open');
    assert.ok(await page.locator('#sf-menu input[type=range]').count() >= 1, 'menu has the width slider');
    assert.ok(await page.locator('#sf-menu .sf-menu-row', { hasText: 'Theme' }).count() >= 1, 'menu has the Theme row');
  });
});

test('comment round-trip: hover block → click → compose → submit persists and renders', needsChrome, async () => {
  await withSpec({}, async ({ page, base, id }) => {
    const block = page.locator('#overview p').first();
    const blockText = (await block.innerText()).replace(/\s+/g, ' ').trim();

    // Hovering the block highlights it (real layout / hit-testing — jsdom can't).
    await block.hover();
    await page.waitForFunction(() => !!document.querySelector('.sf-hover'));

    // Clicking the block opens the composer for that block — no text selection.
    // The composer is a bubble in the rail; it was a standalone #sf-compose panel
    // when this test was written.
    await block.click();
    await page.locator('.sf-bub-compose textarea').fill('E2E block comment');
    await page.locator('.sf-bub-compose .sf-primary').click();

    // The comment must persist through the HTTP API with a block anchor.
    let threads = [];
    for (let i = 0; i < 20 && threads.length === 0; i++) {
      const res = await fetch(`${base}/api/spec/${id}/comments`);
      threads = (await res.json()).threads || [];
      if (threads.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(threads.length, 1, 'one thread persisted via the API');
    assert.equal(threads[0].anchor.block.tag, 'P', 'anchored to the clicked block');
    assert.equal(threads[0].anchor.block.text, blockText, 'anchor carries the block text');
    // The audience chip defaults to the agent, so the stored body carries the
    // mention that makes this thread part of a review batch.
    assert.equal(threads[0].comments[0].body, '@agent E2E block comment');
    assert.equal(threads[0].comments[0].author, 'human');

    // ...and render in the sidebar, marking the block in the document.
    await page.waitForSelector('.sf-thread', { timeout: 8000 });
    assert.match(await page.locator('.sf-thread').first().innerText(), /E2E block comment/);
    await page.waitForSelector('#overview p.sf-block-mark', { timeout: 8000 });
  });
});

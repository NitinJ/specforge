// End-to-end tests for the review layer in a real browser. These cover what
// jsdom cannot: layout (the SpecForge launcher menu is the single floating
// control and is clickable) and the full comment round-trip driven through real
// clicks + the HTTP API. Run with `npm run test:e2e`.
//
// Uses whatever chromium build is already cached under ~/.cache/ms-playwright
// (via executablePath) so it never triggers a browser download; if none is
// present the suite skips rather than failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { chromium } from 'playwright';

import { createApp } from '../server/app.mjs';
import { buildIndex } from '../lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

function findCachedChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d));
  if (!dir) return null;
  const exe = join(base, dir, 'chrome-linux64', 'chrome');
  return existsSync(exe) ? exe : null;
}

const CHROME = findCachedChromium();

function makeSpecsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
  const file = join(dir, '2026-06-02-e2e-spec.html');
  writeFileSync(file, TEMPLATE.replace('{{TITLE}}', 'E2E Spec'));
  return { dir, file };
}

async function withServerAndPage(fn) {
  const { dir } = makeSpecsDir();
  const id = buildIndex(dir)[0].id;
  const server = createApp({ specsDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    // The injected SSE EventSource keeps the network busy, so 'networkidle'
    // would never fire — wait for DOM + the review chrome instead.
    await page.goto(`${base}/spec/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    return await fn({ page, base, id });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

test('the launcher is the single floating control, is clickable, and opens the menu with the review rows', { skip: CHROME ? false : 'no cached chromium' }, async () => {
  await withServerAndPage(async ({ page }) => {
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

test('comment round-trip: hover block → click → compose → submit persists and renders', { skip: CHROME ? false : 'no cached chromium' }, async () => {
  await withServerAndPage(async ({ page, base, id }) => {
    const block = page.locator('#overview p').first();
    const blockText = (await block.innerText()).replace(/\s+/g, ' ').trim();

    // Hovering the block highlights it (real layout / hit-testing — jsdom can't).
    await block.hover();
    await page.waitForFunction(() => !!document.querySelector('.sf-hover'));

    // Clicking the block opens the composer for that block — no text selection.
    await block.click();
    await page.locator('#sf-compose textarea').fill('E2E block comment');
    await page.locator('#sf-compose').getByText('Comment', { exact: true }).click();

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
    assert.equal(threads[0].comments[0].body, 'E2E block comment');
    assert.equal(threads[0].comments[0].author, 'human');

    // ...and render in the sidebar, marking the block in the document.
    await page.waitForSelector('.sf-thread', { timeout: 8000 });
    assert.match(await page.locator('.sf-thread').first().innerText(), /E2E block comment/);
    await page.waitForSelector('#overview p.sf-block-mark', { timeout: 8000 });
  });
});

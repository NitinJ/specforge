#!/usr/bin/env node
// Screenshot the index page in both themes, against the real store.
//
//   node tools/shot-index.mjs <outDir> [url] [chromiumPath]
//
// Launches its own browser rather than attaching to one, so it cannot evict a
// shared/automation browser someone has open. With no third argument it uses
// whatever Playwright installed for itself; pass a path (or set SF_CHROMIUM) to
// point at a binary that is already on the machine, which is the usual case when
// Playwright came in as a transitive dependency and never downloaded a browser.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] || '.';
const url = process.argv[3] || 'http://127.0.0.1:4180/';
const exe = process.argv[4] || process.env.SF_CHROMIUM || null;

mkdirSync(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
} catch (err) {
  throw new Error(`${err.message}\n\nEither run "npx playwright install chromium", `
    + 'or pass the path to an existing chromium as the third argument.');
}
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

for (const theme of ['light', 'dark']) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/index-${theme}.png` });
}

// Hover a row so the row-level affordances (id, tag, rename, actions) show.
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('.row[data-id]').first().hover();
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/index-hover.png`, clip: { x: 0, y: 0, width: 1440, height: 560 } });

// Selection state: the bulk bar.
for (const i of [0, 1, 2]) await page.locator('.row .sel').nth(i).check();
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/index-bulk.png` });

// Each saved view, plus a collection, plus a mid-scroll frame for the sticky headers.
for (const v of ['attn', 'live', 'shared']) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator(`.nav[data-view="${v}"]`).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/index-view-${v}.png`, clip: { x: 0, y: 0, width: 1440, height: 620 } });
}

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.mouse.wheel(0, 900);
await page.waitForTimeout(200);
await page.locator('.crow').first().hover();
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/index-scrolled.png`, clip: { x: 0, y: 0, width: 1440, height: 620 } });

await browser.close();
console.log(`wrote ${out}/index-{light,dark,hover,bulk}.png`);

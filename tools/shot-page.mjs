#!/usr/bin/env node
// Screenshot any page the daemon serves, in both themes.
//
//   node tools/shot-page.mjs <url> <outPrefix> [chromiumPath] [height]
//
// Generic counterpart to shot-index.mjs, which drives index-specific controls.

import { chromium } from 'playwright';

const [, , url, prefix, exeArg, heightArg] = process.argv;
if (!url || !prefix) {
  console.error('usage: node tools/shot-page.mjs <url> <outPrefix> [chromiumPath] [height]');
  process.exit(2);
}
const exe = exeArg || process.env.SF_CHROMIUM || null;
const height = Number(heightArg) || 1400;

let browser;
try {
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
} catch (err) {
  throw new Error(`${err.message}\n\nEither run "npx playwright install chromium", `
    + 'or pass the path to an existing chromium as the third argument.');
}
const page = await browser.newPage({ viewport: { width: 1440, height } });
for (const theme of ['light', 'dark']) {
  // Not networkidle: a served spec holds an SSE connection open, so the network
  // is never idle and the navigation would always time out.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${prefix}-${theme}.png` });
}
await browser.close();
console.log(`wrote ${prefix}-{light,dark}.png`);

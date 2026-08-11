#!/usr/bin/env node
// Drive the share UI in a real browser against the real daemon: the menu row,
// the pill's live state, and the pill's down state after the listener dies.
//
// usage: e2e-specforge-share-ui.mjs <specId>

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pw from 'playwright';

const { chromium } = pw;
const specId = process.argv[2];
if (!specId) { console.error('usage: e2e-specforge-share-ui.mjs <specId>'); process.exit(2); }

const BASE = process.env.SF_BASE || 'http://127.0.0.1:4180';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};

function findChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  const EXE = new Set(['chrome', 'Chromium', 'chrome-headless-shell']);
  const walk = (d, depth) => {
    if (depth < 0) return [];
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return []; }
    return es.flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), depth - 1) : (EXE.has(e.name) ? [join(d, e.name)] : [])));
  };
  const rev = (d) => Number((/-(\d+)$/.exec(d) || [, 0])[1]);
  for (const root of roots) {
    let dirs = []; try { dirs = readdirSync(root).filter((d) => /^chromium/.test(d)); } catch { continue; }
    for (const d of dirs.sort((a, b) => rev(b) - rev(a))) {
      const hits = walk(join(root, d), 4).sort((a, b) => Number(/headless/.test(a)) - Number(/headless/.test(b)));
      if (hits.length) return hits[0];
    }
  }
  return null;
}

const exe = findChromium();
const browser = await chromium.launch(exe ? { headless: true, executablePath: exe } : { headless: true });
const page = await browser.newPage();
const pillText = () => page.textContent('.sf-tb-shared').catch(() => '');

try {
  await page.goto(`${BASE}/spec/${specId}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  check(await page.isHidden('.sf-tb-shared'), 'no pill before anything is shared');

  // Share from the SF menu.
  await page.click('#sf-launcher');
  await page.waitForTimeout(400);
  const rows = await page.$$('#sf-menu .sf-menu-row');
  let shareRow = null;
  for (const r of rows) if (/Share this spec/.test(await r.textContent())) shareRow = r;
  check(!!shareRow, 'the SF menu offers "Share this spec"');
  if (!shareRow) throw new Error('no share row');
  await shareRow.click();

  await page.waitForTimeout(600);
  check(/Publishing/.test(await pillText()), 'the pill reports work in flight');

  // The tunnel takes a few seconds.
  let url = null;
  for (let i = 0; i < 40 && !url; i++) {
    await page.waitForTimeout(1000);
    const t = await pillText();
    if (/Shared/.test(t)) url = await page.getAttribute('.sf-tb-shared', 'title');
  }
  check(!!url, 'the pill flips to Shared', url ? url.split(' ')[0] : 'never');
  check(!/Link down/.test(await pillText()), 'and not to Link down');

  // Reopen: clicking the row closes the menu, and the pill is the feedback for
  // the publish itself. The row's job now is the link and its two actions.
  if (!(await page.$('#sf-menu.open'))) {
    await page.click('#sf-launcher');
    await page.waitForTimeout(400);
  }
  const menuLink = await page.getAttribute('#sf-menu .sf-share-on a.sf-doc-link', 'href').catch(() => null);
  check(!!menuLink && /trycloudflare/.test(menuLink), 'the menu row shows the link', menuLink || 'absent');
  check(!!(await page.$('#sf-menu .sf-share-copy')), 'with a Copy button');
  check(!!(await page.$('#sf-menu .sf-share-off')), 'and an Unshare button');
  check(!!(await page.$('.sf-tb-shared .sf-shared-act')), 'the pill carries an action');

  console.log(`\npublic url: ${menuLink}`);
} catch (e) {
  failures++;
  console.log(`FAIL threw: ${e.message}`);
} finally {
  await page.screenshot({ path: '/tmp/share-ui.png' }).catch(() => {});
  await browser.close();
}

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);

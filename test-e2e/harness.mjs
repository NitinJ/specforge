// The shared browser harness for the e2e suite.
//
// Everything here exists because jsdom cannot answer the questions these tests
// ask: whether an element is the top hit-target at a point, what a property
// actually computes to, and whether a script that runs on load changed the page.
// The review layer has already shipped one defect of that class (a
// `<script src="undefined">` that every jsdom test passed and one real render
// caught), which is why the harness is a first-class module rather than a few
// lines copied into each file.
//
// It uses whatever chromium is already cached under ~/.cache/ms-playwright, so it
// never triggers a download; with none present, callers skip rather than fail.

import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { chromium } from 'playwright';

import { createSpec } from '../lib/store.mjs';
import { createDaemon } from '../server/daemon.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The spec shell an e2e fixture starts from, with its placeholders filled. */
export function baseSpec(title = 'E2E Spec') {
  return readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8')
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DATE}}', '2026-01-01')
    .replaceAll('{{STATUS}}', 'draft')
    .replaceAll('{{OWNER}}', 'e2e');
}

/**
 * The newest cached chromium, or null.
 *
 * Sorted descending so a machine holding several builds uses the most recent
 * rather than whichever readdir happened to return first.
 */
export function findCachedChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = join(base, d, 'chrome-linux64', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export const CHROME = findCachedChromium();

/** `{ skip }` for node:test, so a machine with no browser reports skip, not fail. */
export const needsChrome = { skip: CHROME ? false : 'no cached chromium' };

/**
 * Serve one spec from a throwaway store and open it in a real browser.
 *
 * The store is a temp dir pointed at by SPECFORGE_HOME, the daemon binds an
 * ephemeral port, and both are torn down even when the body throws.
 *
 * @param {{html?:string, title?:string, wait?:string}} opts `wait` is the
 *   selector proving the review layer booted; the default is the launcher.
 * @param {(ctx:{page:object, base:string, id:string}) => Promise<any>} fn
 */
export async function withSpec(opts, fn) {
  const { html = baseSpec(), title = 'E2E Spec', wait = '#sf-launcher' } = opts || {};
  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
  const prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;

  let id;
  let server;
  let browser;
  try {
    id = createSpec({ title, html });
    server = createDaemon();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Not 'networkidle': the injected EventSource is a response that never
    // completes, so the network is never idle on a served spec.
    await page.goto(`${base}/spec/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(wait);
    return await fn({ page, base, id });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * What a CSS property computes to in light and in dark, and whether it moved.
 *
 * This is the only way to tell a palette-driven colour from a hard-coded one:
 * both look correct in a single screenshot, and only one of them re-themes. The
 * theme is restored afterwards so a caller can keep asserting on the same page.
 *
 * @param {object} page playwright page
 * @param {string} selector
 * @param {string} prop CSS property name, e.g. 'fill' or 'color'
 * @returns {Promise<{light:string, dark:string, changed:boolean}>}
 */
export async function computedAcrossThemes(page, selector, prop) {
  const read = async (theme) => page.evaluate(([sel, p, t]) => {
    document.documentElement.setAttribute('data-theme', t);
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matches ${sel}`);
    // Forces style resolution before reading, so the value is never the
    // pre-flip one on a browser that batches recalculation.
    void el.getBoundingClientRect();
    return getComputedStyle(el).getPropertyValue(p);
  }, [selector, prop, theme]);

  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const light = await read('light');
  const dark = await read('dark');
  await page.evaluate((t) => {
    if (t === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, before);

  return { light, dark, changed: light !== dark };
}

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
 * A chromium this Playwright can drive, or null.
 *
 * Playwright's own answer first: it pins a chromium revision per release, and a
 * build from a different release can fail to launch or speak a protocol this
 * client does not. `executablePath()` is that pinned build, so when it is on
 * disk it is the only correct choice.
 *
 * The cache scan is a fallback for the common developer state where some
 * chromium is cached but not the pinned one (a Playwright upgrade downloads a
 * new revision and leaves the old, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`
 * leaves none). Newest first, because a revision near the pinned one is likelier
 * to work than an old one. It is best-effort by construction: without it the
 * choice is not "a safer browser" but "no browser".
 */
export function findCachedChromium() {
  try {
    const pinned = chromium.executablePath();
    if (pinned && existsSync(pinned)) return pinned;
  } catch {
    // Playwright throws when the browser was never registered; fall through.
  }
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
 * ephemeral port, and every one of them is torn down even when the body throws.
 *
 * @param {object} opts
 * @param {string} [opts.html] the spec's HTML; defaults to the base shell
 * @param {string} [opts.title]
 * @param {string} [opts.type] spec type recorded in meta
 * @param {string} [opts.wait] selector proving the review layer booted
 * @param {boolean} [opts.acceptDownloads] also hand the body a `downloads` dir
 * @param {string[]} [opts.permissions] browser permissions to grant, e.g.
 *   `['clipboard-read', 'clipboard-write']`. Without them a clipboard read is
 *   refused and the copy control can only be tested by its own label, which is
 *   the component asserting its own success.
 * @param {(ctx:{page:object, base:string, id:string, downloads:string|null}) => Promise<any>} fn
 */
export async function withSpec(opts, fn) {
  const {
    html = baseSpec(), title = 'E2E Spec', type, wait = '#sf-launcher',
    acceptDownloads = false, permissions,
  } = opts || {};

  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
  const prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  const downloads = acceptDownloads ? mkdtempSync(join(tmpdir(), 'sf-e2e-dl-')) : null;

  let server;
  let browser;
  try {
    const id = createSpec({ title, html, type });
    server = createDaemon();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      acceptDownloads,
      ...(permissions ? { permissions } : {}),
    });
    // Not 'networkidle': the injected EventSource is a response that never
    // completes, so the network is never idle on a served spec.
    await page.goto(`${base}/spec/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(wait);
    return await fn({ page, base, id, downloads });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    if (downloads) rmSync(downloads, { recursive: true, force: true });
  }
}

/**
 * Record every request a page makes, from before the first navigation.
 *
 * The child-spec panel claims to load nothing until the reader opens a child.
 * That claim is only checkable as a count over time: "no request for this URL
 * yet, then exactly one after the click". Attach this before `goto`, because a
 * listener added afterwards has already missed the page's own load.
 *
 * @param {object} page playwright page
 * @returns {{urls: string[], matching: (re: RegExp) => string[], clear: () => void}}
 */
export function recordRequests(page) {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  return {
    urls,
    matching: (re) => urls.filter((u) => re.test(u)),
    clear: () => { urls.length = 0; },
  };
}

/**
 * Serve a whole tree of specs from a throwaway store and open one of them.
 *
 * `withSpec` covers one document, which is every e2e test written before child
 * specs. This is the same harness with a tree: `specs` is a list of
 * `{ key, title, html, type, parent }`, where `parent` names another entry's
 * `key`, and `open` says which key to navigate to. Requests are recorded from
 * before the first navigation, so a test can assert what was NOT fetched.
 *
 * @param {object} opts
 * @param {Array<object>} opts.specs
 * @param {string} [opts.open] key to open; defaults to the first entry
 * @param {string} [opts.wait] selector proving the review layer booted
 * @param {(ctx:{page:object, base:string, ids:object, requests:object}) => Promise<any>} fn
 */
export async function withSpecTree(opts, fn) {
  const { specs = [], open, wait = '#sf-launcher' } = opts || {};
  if (!specs.length) throw new Error('withSpecTree needs at least one spec');

  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-tree-'));
  const prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;

  let server;
  let browser;
  try {
    // Validated before anything is written, because the failure it prevents is
    // silent: a misspelled `parent` key resolves to undefined, the spec is
    // created as a root, and every later assertion then tests a topology nobody
    // asked for and the test still passes.
    const keys = new Set();
    for (const s of specs) {
      if (!s.key) throw new Error('withSpecTree: every spec needs a key');
      if (keys.has(s.key)) throw new Error(`withSpecTree: duplicate key ${s.key}`);
      keys.add(s.key);
    }
    for (const s of specs) {
      if (s.parent === undefined || s.parent === null) continue;
      if (!keys.has(s.parent)) {
        throw new Error(`withSpecTree: ${s.key} names parent ${s.parent}, which is not a key`);
      }
      if (s.parent === s.key) throw new Error(`withSpecTree: ${s.key} is its own parent`);
    }

    // Two passes: create every spec, then set parents, so an entry may name a
    // parent declared after it.
    const ids = {};
    for (const s of specs) {
      ids[s.key] = createSpec({
        title: s.title || s.key,
        html: s.html || baseSpec(s.title || s.key),
        type: s.type,
      });
    }
    const { readMeta, writeMeta } = await import('../lib/meta.mjs');
    for (const s of specs) {
      if (!s.parent) continue;
      const meta = readMeta(ids[s.key]);
      writeMeta(ids[s.key], { ...meta, parent: ids[s.parent] });
    }
    if (open && !keys.has(open)) throw new Error(`withSpecTree: open names ${open}, which is not a key`);

    server = createDaemon();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const requests = recordRequests(page);

    const openKey = open || specs[0].key;
    await page.goto(`${base}/spec/${ids[openKey]}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(wait);
    return await fn({ page, base, ids, requests });
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
  let light;
  let dark;
  try {
    light = await read('light');
    dark = await read('dark');
  } finally {
    // In `finally`, because a throwing probe is exactly when the caller is most
    // likely to carry on with other assertions on this page. Leaving the flip
    // half-applied would make those assertions read a theme nobody chose.
    await page.evaluate((t) => {
      if (t === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    }, before);
  }

  return { light, dark, changed: light !== dark };
}

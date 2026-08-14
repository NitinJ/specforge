// End-to-end: the "Download markdown" row in the review UI, driven by a real
// click in a real browser.
//
// What this covers that test/daemon-md.test.mjs cannot: the row is actually in
// the menu, the anchor points at the route, and the browser treats the response
// as a download with the filename the server asked for. A fetch() test proves
// the bytes; only a browser proves the button.
//
// Run with `npm run test:e2e`. Uses whatever chromium is already cached under
// ~/.cache/ms-playwright, so it never triggers a download; with none present it
// skips rather than failing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findCachedChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    const exe = join(base, d, 'chrome-linux64', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const CHROME = findCachedChromium();
const skip = CHROME ? false : 'no cached chromium';

/** A daemon over a throwaway store, with one spec in it. */
async function withSpec(fixtureName, title, fn) {
  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-md-'));
  const prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;

  // Imported after SPECFORGE_HOME is set: the store reads it at call time, but
  // the daemon seeds templates on construction.
  const { createSpec } = await import('../lib/store.mjs');
  const { createDaemon } = await import('../server/daemon.mjs');
  const { fixture } = await import('../test/fixtures/md/index.mjs');

  const id = createSpec({ html: fixture(fixtureName).html(), title, type: 'design' });
  const server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const downloads = mkdtempSync(join(tmpdir(), 'sf-e2e-dl-'));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  try {
    await page.goto(`${base}/spec/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    return await fn({ page, base, id, downloads });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    rmSync(home, { recursive: true, force: true });
    rmSync(downloads, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prevHome;
  }
}

async function openMenu(page) {
  await page.locator('#sf-launcher').click();
  await page.waitForSelector('.sf-menu-row');
}

test('the download row is in the menu and saves a .md for a spec with no diagrams', { skip }, async () => {
  await withSpec('design', 'Retry policy', async ({ page, downloads }) => {
    await openMenu(page);
    const link = page.locator('a.sf-doc-link', { hasText: 'Download markdown' });
    assert.equal(await link.count(), 1, 'exactly one download row');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      link.click(),
    ]);
    assert.equal(download.suggestedFilename(), 'retry-policy.md');

    const saved = join(downloads, download.suggestedFilename());
    await download.saveAs(saved);
    const body = readFileSync(saved, 'utf8');
    assert.match(body, /^---\n/, 'frontmatter');
    assert.match(body, /^# Retry policy for webhook delivery$/m);
    assert.match(body, /^\| Attempt \| Nominal delay \| Cumulative \|$/m, 'a GFM table');
  });
});

test('a spec with diagrams saves a .zip instead', { skip }, async () => {
  await withSpec('diagrams', 'Topology', async ({ page, downloads }) => {
    await openMenu(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('a.sf-doc-link', { hasText: 'Download markdown' }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'topology.zip');

    const saved = join(downloads, download.suggestedFilename());
    await download.saveAs(saved);
    const buf = readFileSync(saved);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'a real zip');
    assert.ok(buf.includes(Buffer.from('topology.assets/architecture-1.svg')), 'with the diagrams inside');
  });
});

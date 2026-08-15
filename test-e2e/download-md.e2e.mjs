// End-to-end: the "Download markdown" row in the review UI, driven by a real
// click in a real browser.
//
// What this covers that test/daemon-md.test.mjs cannot: the row is actually in
// the menu, the anchor points at the route, and the browser treats the response
// as a download with the filename the server asked for. A fetch() test proves
// the bytes; only a browser proves the button.
//
// Run with `npm run test:e2e`. Store, server and browser come from
// ./harness.mjs, so this file cannot pick a different chromium than the rest of
// the suite; it used to carry its own lookup and could.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { withSpec, needsChrome } from './harness.mjs';
import { fixture } from '../test/fixtures/md/index.mjs';

/** One of the markdown fixtures, served and opened with downloads enabled. */
function withFixture(name, title, fn) {
  return withSpec({
    html: fixture(name).html(), title, type: 'design', acceptDownloads: true,
  }, fn);
}

async function openMenu(page) {
  await page.locator('#sf-launcher').click();
  await page.waitForSelector('.sf-menu-row');
}

test('the download row is in the menu and saves a .md for a spec with no diagrams', needsChrome, async () => {
  await withFixture('design', 'Retry policy', async ({ page, downloads }) => {
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

test('a spec with diagrams saves a .zip instead', needsChrome, async () => {
  await withFixture('diagrams', 'Topology', async ({ page, downloads }) => {
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

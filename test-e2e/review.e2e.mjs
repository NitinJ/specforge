// End-to-end tests for the review layer in a real browser. These cover what
// jsdom cannot: layout (the review toggle must not collide with the spec's own
// theme toggle) and the full comment round-trip driven through real clicks +
// the HTTP API. Run with `npm run test:e2e`.
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
    await page.waitForSelector('#sf-toggle');
    return await fn({ page, base, id });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

test('review toggle and theme toggle do not collide and are both clickable', { skip: CHROME ? false : 'no cached chromium' }, async () => {
  await withServerAndPage(async ({ page }) => {
    assert.equal(await page.locator('#sf-toggle').count(), 1, 'exactly one review toggle');
    assert.equal(await page.locator('#sf-sidebar').count(), 1, 'exactly one sidebar');

    const geom = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
      const sf = document.getElementById('sf-toggle');
      const th = document.getElementById('themeToggle');
      const overlap = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t));
      const top = (el, g) => { const h = document.elementFromPoint(g.cx, g.cy); return h === el || el.contains(h); };
      const sfg = r(sf); const thg = r(th);
      return { overlap: overlap(sfg, thg), sfClickable: top(sf, sfg), themeClickable: top(th, thg) };
    });
    assert.equal(geom.overlap, 0, 'review toggle and theme toggle must not overlap');
    assert.ok(geom.sfClickable, 'review toggle is the top hit-target at its center');
    assert.ok(geom.themeClickable, 'theme toggle is the top hit-target at its center');
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

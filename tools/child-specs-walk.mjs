#!/usr/bin/env node
// Walk the two child-specs journeys in a real browser and screenshot each step.
//
// The e2e suite asserts the behaviour; this is for looking at it. A panel can
// pass every assertion and still be laid out wrong, and the only way to know is
// to look. Screenshots land in the directory given as the first argument.
//
//   node tools/child-specs-walk.mjs /tmp/shots

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] || join(tmpdir(), 'child-specs-shots');
mkdirSync(out, { recursive: true });

// Everything acquired below is torn down by `cleanup`, which is registered
// immediately and run from both the finally and the signals. A walkthrough is
// interrupted more often than it is finished — the whole point is to look at a
// screenshot and stop — and a throwaway store that outlives its run is not
// throwaway.
const store = mkdtempSync(join(tmpdir(), 'sf-walk-'));
process.env.SPECFORGE_HOME = store;

let browser;
let server;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { if (browser) await browser.close(); } catch {}
  try { if (server) server.close(); } catch {}
  rmSync(store, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { cleanup().then(() => process.exit(130)); });
}

const { createSpec } = await import('../lib/store.mjs');
const { createDaemon } = await import('../server/daemon.mjs');
const { CHROME, baseSpec } = await import('../test-e2e/harness.mjs');
const { chromium } = await import('playwright');

/**
 * A spec built on the real house shell.
 *
 * Not a hand-written stylesheet. The chrome's tokens fall back to the spec's own
 * (`--sf-ink: var(--ink, …)`), so a fixture that defines half a palette produces
 * a chrome nobody would ever see: light text on a white drawer, from a spec that
 * set `--ink` and not `--panel`. The lint requires all of them, so every real
 * spec defines all of them, and a screenshot is only worth taking of a page that
 * could exist.
 */
function doc(title) {
  const body = `<section id="tldr"><h2>TL;DR</h2><p>${title}: something to look at.</p></section>
<section id="design"><h2>Design</h2>
<pre data-lang="mermaid"><code>flowchart LR
  A[parent] --&gt; B[child]</code></pre>
<pre data-lang="javascript"><code>const parent = readMeta(id).parent;</code></pre>
</section>`;
  return baseSpec(title).replace('</main>', `${body}\n</main>`);
}

const root = createSpec({ title: 'Design spec', type: 'design', html: doc('Design spec') });
const kid = createSpec({ title: 'Code grounding', type: 'research', parent: root, html: doc('Code grounding') });
const kid2 = createSpec({ title: 'Testing strategy', type: 'test-plan', parent: root, html: doc('Testing strategy') });
createSpec({ title: 'Fixture inventory', type: 'general', parent: kid2, html: doc('Fixture inventory') });

try {
  server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('li.row');
  await shot('01-index-tree');

  await page.click('.nav[data-view="attn"]');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'attn');
  await shot('02-index-attention-flat');
  await page.click('.nav[data-view="all"]');

  await page.goto(`${base}/spec/${root}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sf-launcher');
  await page.click('#sf-launcher');
  await page.waitForSelector('#sf-menu');
  await shot('03-menu-with-child-specs-row');

  await page.click('#sf-menu .sf-menu-row:has-text("Child specs")');
  await page.waitForSelector('#sf-children.open');
  // The drawer slides in over 180ms; a shot taken the moment the class lands
  // catches it mid-transform and reads as a layout bug that is not there.
  await page.waitForTimeout(400);
  await shot('04-child-drawer');

  await page.click('#sf-children .sf-child-row');
  await page.waitForSelector('#sf-child-panel.open');
  await page.waitForFunction(() => {
    const f = document.querySelector('#sf-child-frame');
    return f && f.contentDocument && f.contentDocument.body
      && f.contentDocument.body.textContent.includes('something to look at');
  }, null, { timeout: 15000 });
  await page.waitForTimeout(600);   // let mermaid finish inside the frame
  await shot('05-child-panel');

  await page.goto(`${base}/spec/${root}?flat=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await shot('06-flat-print-view');

  console.log(`screenshots in ${out}`);
  console.log(`ids: root=${root} children=${kid},${kid2}`);
} finally {
  await cleanup();
}

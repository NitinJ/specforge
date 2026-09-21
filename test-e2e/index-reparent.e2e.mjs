// Moving a spec under another from the home page, in a real browser.
//
// The DOM tests cover which rows the menu draws, which specs the picker offers
// and what each HTTP status does. Three things need a browser: the popover has
// to place itself and take focus, the reload has to land on a page that redraws
// the tree, and the refusal has to leave a page that was never reloaded intact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { CHROME, needsChrome } from './harness.mjs';
import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { metaPath } from '../lib/store-paths.mjs';

/** The index page, in a browser, over a store this function seeds. */
async function withIndex(seed, fn) {
  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-reparent-'));
  const prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;

  let server;
  let browser;
  try {
    const ids = seed();
    server = createDaemon();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('li.row');
    return await fn({ page, base, ids, browser });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

/** Two roots, deliberately in different projects: a parent is not a filing. */
const seedTwoRoots = () => ({
  parent: createSpec({ title: 'Journey parent', html: '<h1>p</h1>', project: 'alpha' }),
  orphan: createSpec({ title: 'Journey orphan', html: '<h1>o</h1>', project: 'beta' }),
});

const parentOf = (id) => JSON.parse(readFileSync(metaPath(id), 'utf8')).parent;
const metaOf = (id) => JSON.parse(readFileSync(metaPath(id), 'utf8'));

/** Open a row's menu and click the row with this label. */
async function menuClick(page, id, label) {
  await page.click(`li.row[data-id="${id}"] .kebab`);
  await page.waitForSelector('#menu:not([hidden])');
  await page.click(`#menu .mitem:has-text("${label}")`);
}

test('a spec is moved under another, keeping its own project', needsChrome, async () => {
  await withIndex(seedTwoRoots, async ({ page, ids }) => {
    await menuClick(page, ids.orphan, 'Move under spec');
    await page.waitForSelector('#cpick:not([hidden])');

    // The spec being moved is never a destination, whatever is typed.
    await page.fill('#pfilter', 'journey');
    const offered = await page.$$eval('#plist .pitem', (els) => els.map((e) => e.getAttribute('data-v')));
    assert.ok(offered.includes(ids.parent));
    assert.equal(offered.includes(ids.orphan), false);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click(`#plist .pitem[data-v="${ids.parent}"]`),
    ]);
    await page.waitForSelector('li.row');

    assert.equal(parentOf(ids.orphan), ids.parent);
    assert.equal(metaOf(ids.orphan).project, 'beta', 'the move refiled the spec into another project');

    const depth = await page.getAttribute(`li.row[data-id="${ids.orphan}"]`, 'data-depth');
    assert.equal(depth, '1', 'the moved spec is not drawn as a child');
  });
});

test('a child is detached from the menu and returns to the top level', needsChrome, async () => {
  const seed = () => {
    const parent = createSpec({ title: 'Journey parent', html: '<h1>p</h1>' });
    return { parent, kid: createSpec({ title: 'Journey kid', html: '<h1>k</h1>', parent }) };
  };
  await withIndex(seed, async ({ page, ids }) => {
    await page.click(`li.row[data-id="${ids.kid}"] .kebab`);
    await page.waitForSelector('#menu:not([hidden])');
    const labels = await page.$$eval('#menu .mitem', (els) => els.map((e) => e.lastElementChild.textContent));
    assert.ok(labels.some((l) => l === 'Detach from parent'));

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('#menu .mitem:has-text("Detach from parent")'),
    ]);
    await page.waitForSelector('li.row');

    assert.equal(parentOf(ids.kid), null);
    assert.equal(await page.getAttribute(`li.row[data-id="${ids.kid}"]`, 'data-depth'), '0');
  });
});

test('a root row offers no detach', needsChrome, async () => {
  await withIndex(seedTwoRoots, async ({ page, ids }) => {
    await page.click(`li.row[data-id="${ids.parent}"] .kebab`);
    await page.waitForSelector('#menu:not([hidden])');
    const labels = await page.$$eval('#menu .mitem', (els) => els.map((e) => e.lastElementChild.textContent));

    assert.ok(labels.some((l) => l === 'Move under spec…'));
    assert.equal(labels.some((l) => l === 'Detach from parent'), false);
  });
});

test('a stale page that would make a loop is refused, and nothing moves', needsChrome, async () => {
  await withIndex(seedTwoRoots, async ({ page, ids, browser }) => {
    // A second tab makes the move, so the first one's tree is out of date. That
    // is the only ordinary way to reach the cycle: the picker filters the rest.
    const other = await browser.newPage();
    await other.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await other.waitForSelector('li.row');
    await menuClick(other, ids.orphan, 'Move under spec');
    await other.waitForSelector('#cpick:not([hidden])');
    await Promise.all([
      other.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      other.click(`#plist .pitem[data-v="${ids.parent}"]`),
    ]);
    assert.equal(parentOf(ids.orphan), ids.parent);

    // The stale tab still believes both are roots, so it offers the loop.
    await menuClick(page, ids.parent, 'Move under spec');
    await page.waitForSelector('#cpick:not([hidden])');
    await page.click(`#plist .pitem[data-v="${ids.orphan}"]`);

    const said = await page.textContent('.sfui-snack-msg');
    assert.match(said, /Journey parent/);
    assert.match(said, /Journey orphan/);

    assert.equal(parentOf(ids.parent), null, 'a refused move wrote a parent anyway');
    assert.equal(parentOf(ids.orphan), ids.parent, 'a refused move disturbed the other spec');
    await other.close();
  });
});

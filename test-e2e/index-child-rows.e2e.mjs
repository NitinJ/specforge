// Children on the home page, in a real browser.
//
// Two things here need one: the indent is CSS, and the undo after a delete spans
// the page, the route and a reload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { CHROME, needsChrome } from './harness.mjs';
import { createDaemon } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';

/** The index page, in a browser, over a store this function seeds. */
async function withIndex(seed, fn) {
  const home = mkdtempSync(join(tmpdir(), 'sf-e2e-index-'));
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
    return await fn({ page, base, ids });
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

const seedTree = () => {
  const root = createSpec({ title: 'Design spec', html: '<h1>Design spec</h1>' });
  const a = createSpec({ title: 'Code grounding', html: '<h1>a</h1>', parent: root });
  const b = createSpec({ title: 'Testing strategy', html: '<h1>b</h1>', parent: root });
  return { root, a, b };
};

test('a child row is drawn indented, and its parent is not', needsChrome, async () => {
  await withIndex(seedTree, async ({ page, ids }) => {
    const left = (id) => page.evaluate((specId) => {
      const row = document.querySelector(`li.row[data-id="${specId}"] .main`);
      return getComputedStyle(row).paddingLeft;
    }, id);

    assert.equal(await left(ids.root), '0px');
    assert.notEqual(await left(ids.a), '0px', 'the child row is not indented');
  });
});

test('the attention view flattens the indent and names the parent', needsChrome, async () => {
  await withIndex(seedTree, async ({ page, ids }) => {
    await page.click('.nav[data-view="attn"]');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'attn');

    const shown = await page.evaluate((specId) => {
      const row = document.querySelector(`li.row[data-id="${specId}"]`);
      const under = row.querySelector('.under');
      return {
        padding: getComputedStyle(row.querySelector('.main')).paddingLeft,
        under: under ? getComputedStyle(under).display : 'missing',
        text: under ? under.textContent : '',
      };
    }, ids.a);

    assert.equal(shown.padding, '0px', 'the indent survived into a flat view');
    assert.notEqual(shown.under, 'none', 'the parent is not named in a flat view');
    assert.match(shown.text, /Design spec/);
  });
});

test('sorting keeps each child with its parent', needsChrome, async () => {
  await withIndex(seedTree, async ({ page, ids }) => {
    // Sorting every row independently pulled children away from their parents,
    // leaving an indented row under an unrelated spec, still claiming to belong
    // to it.
    await page.selectOption('#fsort', 'title');
    await page.waitForTimeout(200);

    const order = await page.evaluate(() => Array.prototype.map.call(
      document.querySelectorAll('li.row'),
      (r) => [r.getAttribute('data-id'), r.getAttribute('data-depth')],
    ));

    const rootAt = order.findIndex(([id]) => id === ids.root);
    assert.ok(rootAt >= 0, 'the parent is not on the page');
    // Both children follow it, before any other root.
    const after = order.slice(rootAt + 1, rootAt + 3).map(([id]) => id);
    assert.deepEqual([...after].sort(), [ids.a, ids.b].sort());
    for (const [, depth] of order.slice(rootAt + 1, rootAt + 3)) assert.equal(depth, '1');
  });
});

test('leaving a flat view puts the tree back', needsChrome, async () => {
  await withIndex(seedTree, async ({ page, ids }) => {
    await page.click('.nav[data-view="attn"]');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'attn');

    // Picking a collection resets the view without going through a view button,
    // and three such paths used to leave the flat styling in place.
    await page.click('.cnav');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'all');

    const shown = await page.evaluate((specId) => {
      const row = document.querySelector(`li.row[data-id="${specId}"]`);
      const under = row.querySelector('.under');
      return {
        view: document.body.getAttribute('data-view'),
        padding: getComputedStyle(row.querySelector('.main')).paddingLeft,
        under: under ? getComputedStyle(under).display : 'missing',
      };
    }, ids.a);

    assert.equal(shown.view, 'all');
    assert.notEqual(shown.padding, '0px', 'the indent did not come back');
    assert.equal(shown.under, 'none', 'the parent name is still showing outside a flat view');
  });
});

test('deleting a parent says how many go, and can be undone', needsChrome, async () => {
  await withIndex(seedTree, async ({ page, ids }) => {
    await page.click(`li.row[data-id="${ids.root}"] .acts button`);
    await page.click('text=Delete spec…');

    await page.waitForSelector('#sf-dc-body');
    const body = await page.textContent('#sf-dc-body');
    assert.match(body, /2 child specs/, 'the confirmation did not say the children go too');
    assert.match(body, /undo/i);

    await page.click('#sf-dc-ok');
    await page.waitForFunction((id) => !document.querySelector(`li.row[data-id="${id}"]`), ids.root);

    // All three rows go, not just the one that was clicked.
    for (const id of [ids.root, ids.a, ids.b]) {
      assert.equal(await page.$(`li.row[data-id="${id}"]`), null, `${id} is still on the page`);
    }

    await page.waitForSelector('.sfui-snack-act:has-text("Undo")');
    await page.click('.sfui-snack-act:has-text("Undo")');

    await page.waitForFunction((id) => !!document.querySelector(`li.row[data-id="${id}"]`), ids.root);
    for (const id of [ids.root, ids.a, ids.b]) {
      assert.ok(await page.$(`li.row[data-id="${id}"]`), `${id} did not come back`);
    }
    // And the tree is a tree again, not three roots.
    const depth = await page.getAttribute(`li.row[data-id="${ids.a}"]`, 'data-depth');
    assert.equal(depth, '1');
  });
});

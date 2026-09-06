// The child panel, in a real browser.
//
// Two of its claims cannot be checked in jsdom, and they are the two the whole
// iframe decision rests on:
//
//   1. Nothing is fetched for a child until the reader opens it. jsdom does not
//      load an iframe's src, so only a real browser can show the request.
//   2. The child's CSS does not touch the parent. jsdom runs no cascade, so
//      getComputedStyle there would return the same answer either way.
//
// The fixture child carries a deliberately hostile stylesheet: bare element
// selectors with !important, which are harmless in their own document and
// destructive in somebody else's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withSpecTree, needsChrome, baseSpec } from './harness.mjs';

const HOSTILE = `<!DOCTYPE html><html><head><title>Hostile child</title><style>
  body { background: #ff00ff !important; margin: 99px !important; }
  p { color: #00ff00 !important; font-size: 41px !important; }
  h1 { display: none !important; }
</style></head><body><h1>Hostile child</h1><p>Body of the child.</p></body></html>`;

const TREE = [
  { key: 'root', title: 'Parent spec', html: baseSpec('Parent spec') },
  { key: 'kid', title: 'Hostile child', parent: 'root', html: HOSTILE },
];

/** Open the drawer, then the first child. */
async function openFirstChild(page) {
  await page.click('#sf-launcher');
  await page.waitForSelector('#sf-menu');
  await page.click('#sf-menu .sf-menu-row:has-text("Child specs")');
  await page.waitForSelector('#sf-children.open');
  await page.click('#sf-children .sf-child-row');
  await page.waitForSelector('#sf-child-panel.open');
}

test('no child document is fetched until the reader opens one', needsChrome, async () => {
  await withSpecTree({ specs: TREE, open: 'root' }, async ({ page, ids, requests }) => {
    const doc = new RegExp(`/spec/${ids.kid}\\?`);

    await page.click('#sf-launcher');
    await page.waitForSelector('#sf-menu');
    await page.click('#sf-menu .sf-menu-row:has-text("Child specs")');
    await page.waitForSelector('#sf-children.open');
    assert.equal(requests.matching(doc).length, 0, 'listing fetched the child document');

    await page.click('#sf-children .sf-child-row');
    await page.waitForSelector('#sf-child-panel.open');
    await page.waitForFunction(
      (id) => !!document.querySelector(`iframe[src*="${id}"]`),
      ids.kid,
    );
    assert.equal(requests.matching(doc).length, 1, 'the child should load exactly once, on open');
  });
});

test("a child's stylesheet does not reach the page around it", needsChrome, async () => {
  await withSpecTree({ specs: TREE, open: 'root' }, async ({ page }) => {
    const read = () => page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const p = document.querySelector('main p') || document.querySelector('p');
      const ps = p ? getComputedStyle(p) : {};
      const h1 = document.querySelector('h1');
      return {
        bg: body.backgroundColor,
        margin: body.margin,
        color: ps.color || '',
        size: ps.fontSize || '',
        h1Display: h1 ? getComputedStyle(h1).display : '',
      };
    });

    const before = await read();
    await openFirstChild(page);
    // The frame has to have actually rendered, or this proves nothing.
    await page.waitForFunction(() => {
      const f = document.querySelector('#sf-child-frame');
      return f && f.contentDocument && f.contentDocument.body
        && f.contentDocument.body.textContent.includes('Body of the child');
    });
    const after = await read();

    assert.deepEqual(after, before, "the child's CSS changed the parent page");
  });
});

test('the child renders inside the frame, with no chrome of its own', needsChrome, async () => {
  await withSpecTree({ specs: TREE, open: 'root' }, async ({ page }) => {
    await openFirstChild(page);
    const inFrame = await page.evaluate(async () => {
      const f = document.querySelector('#sf-child-frame');
      for (let i = 0; i < 50 && !(f.contentDocument && f.contentDocument.body); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const d = f.contentDocument;
      return {
        text: d.body.textContent,
        launcher: !!d.querySelector('#sf-launcher'),
        toc: !!d.querySelector('#sf-toc'),
        rail: !!d.querySelector('#sf-rail'),
      };
    });

    assert.match(inFrame.text, /Body of the child/, 'the child did not render');
    assert.equal(inFrame.launcher, false, 'a second launcher inside the panel');
    assert.equal(inFrame.toc, false);
    assert.equal(inFrame.rail, false);
  });
});

test('closing the panel unloads the child', needsChrome, async () => {
  await withSpecTree({ specs: TREE, open: 'root' }, async ({ page }) => {
    await openFirstChild(page);
    await page.click('#sf-child-panel .sf-child-close');
    await page.waitForFunction(() => {
      const f = document.querySelector('#sf-child-frame');
      return f && !f.getAttribute('src');
    });
    const open = await page.evaluate(() => document.querySelector('#sf-child-panel').classList.contains('open'));
    assert.equal(open, false);
  });
});

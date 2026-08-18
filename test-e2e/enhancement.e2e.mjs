// The enhancement channel, in a real browser.
//
// Two things can only be answered here. Whether the script is fetched at all for
// a document that has nothing for it to do — a question about a network request,
// which jsdom does not make. And whether the copy control actually puts the code
// on the clipboard, rather than merely saying it did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';
import { LIVE_ATTR, scriptSelectors } from '../components/index.mjs';

const CODE = 'export const PALETTE_TOKENS = [];';

const withCode = () => baseSpec('Enhancement').replace(
  '</main>',
  `<section id="probe"><h2>9 · Probe</h2>
     <div class="codeblock" id="cb">
       <span class="filename">lib/config.mjs</span>
       <pre><code>${CODE}</code></pre>
     </div>
   </section></main>`,
);

/** Every request the page made, so "fetched nothing" can be asserted. */
function track(page) {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

test('a document with nothing interactive never fetches the script', needsChrome, async () => {
  // The bargain the highlighter and the reading fonts already make. A spec of
  // prose pays nothing for a library it does not use.
  await withSpec({ html: baseSpec('Plain') }, async ({ page }) => {
    const urls = track(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(400);
    assert.deepEqual(urls.filter((u) => u.includes('interactive.js')), []);
    assert.equal(await page.evaluate((a) => document.documentElement.hasAttribute(a), LIVE_ATTR),
      false, 'and the document is not marked live');
  });
});

test('a document with a code block fetches it, and goes live', needsChrome, async () => {
  await withSpec({ html: withCode() }, async ({ page }) => {
    await page.waitForFunction((a) => document.documentElement.hasAttribute(a), LIVE_ATTR);
    assert.ok(true, 'the attribute landed, which only interactive.js sets');
  });
});

test('the copy control appears on the block and puts the code on the clipboard', needsChrome, async () => {
  await withSpec({
    html: withCode(),
    permissions: ['clipboard-read', 'clipboard-write'],
  }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    await page.click('#cb .copy');
    await page.waitForSelector('#cb .copy.copied');

    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(pasted, CODE, 'the code as authored, not as highlighted');
  });
});

test('what it copies excludes the filename caption', needsChrome, async () => {
  // The caption is in the block but not in the <code>, and a reader pasting it
  // into a shell would get a path where a command should be.
  await withSpec({
    html: withCode(),
    permissions: ['clipboard-read', 'clipboard-write'],
  }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    await page.click('#cb .copy');
    await page.waitForSelector('#cb .copy.copied');
    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(!pasted.includes('lib/config.mjs'), `caption leaked: ${pasted}`);
  });
});

test('the control says what it copies, for a page with several blocks', needsChrome, async () => {
  await withSpec({ html: withCode() }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    const label = await page.getAttribute('#cb .copy', 'aria-label');
    assert.equal(label, 'Copy lib/config.mjs', 'named, not a twelfth "Copy"');
  });
});

test('the control is reachable and operable by keyboard', needsChrome, async () => {
  await withSpec({
    html: withCode(),
    permissions: ['clipboard-read', 'clipboard-write'],
  }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    await page.focus('#cb .copy');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'copy',
      'it takes focus');
    // Visible on focus, not only on hover: a keyboard user never hovers. Waited
    // for rather than read straight away — the reveal is a 120ms transition, so
    // the first reading is whatever the animation happens to be part-way through.
    await page.waitForFunction(() =>
      parseFloat(getComputedStyle(document.querySelector('#cb .copy')).opacity) > 0.9,
    null, { timeout: 2000 });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cb .copy.copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), CODE);
  });
});

test('a refused Clipboard API still copies, through the fallback', needsChrome, async () => {
  // The API being present says nothing about it being permitted: a denied
  // permission, or a document that was not focused at the moment of the call,
  // rejects. Returning that rejection to the caller skipped a fallback that
  // would have worked, so the button said "Press ⌘C" on a page that could copy.
  await withSpec({ html: withCode() }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    await page.evaluate(() => {
      window.__wrote = null;
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
      // Stand in for the textarea path's execCommand, which headless Chrome does
      // not implement, and record what it was given.
      document.execCommand = () => {
        window.__wrote = document.activeElement && document.activeElement.value;
        return true;
      };
    });
    await page.click('#cb .copy');
    await page.waitForSelector('#cb .copy.copied');
    assert.equal(await page.evaluate(() => window.__wrote), CODE,
      'the fallback ran and was handed the code');
  });
});

test('the block is copied verbatim, whitespace and all', needsChrome, async () => {
  // Nothing is trimmed, because nothing can tell an artifact of the markup from
  // the author's own text: a hand-written block usually has a meaningless
  // newline before `</code>`, an imported fenced block has a meaningful one, and
  // they are the same character. Two guesses were tried and both lost real
  // content — `\s+$` took the two trailing spaces that are a hard line break,
  // `\n+$` took a deliberate final blank line.
  const cases = [
    ['line one  \nline two', 'trailing spaces are a hard line break'],
    ['[server]\nport = 4180\n\n', 'a deliberate final blank line'],
    ['npm test\n', 'and the ordinary trailing newline'],
  ];
  for (const [code, why] of cases) {
    const html = baseSpec('Verbatim').replace('</main>',
      '<section id="p"><h2>9 · P</h2><div class="codeblock" id="cbv">'
      + `<pre><code>${code}</code></pre></div></section></main>`);
    // eslint-disable-next-line no-await-in-loop
    await withSpec({
      html,
      permissions: ['clipboard-read', 'clipboard-write'],
    }, async ({ page }) => {
      await page.waitForSelector('#cbv .copy');
      await page.click('#cbv .copy');
      await page.waitForSelector('#cbv .copy.copied');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code, why);
    });
  }
});

test('the control returns to its resting label', needsChrome, async () => {
  await withSpec({ html: withCode() }, async ({ page }) => {
    await page.waitForSelector('#cb .copy');
    await page.click('#cb .copy');
    await page.waitForSelector('#cb .copy.copied');
    await page.waitForSelector('#cb .copy:not(.copied)', { timeout: 5000 });
    assert.equal(await page.textContent('#cb .copy'), 'Copy');
  });
});

test('nothing is hidden before the script runs', needsChrome, async () => {
  // I1, end to end. With the script blocked the document must be complete: the
  // control is simply absent, which costs a reader a selection rather than the
  // code.
  await withSpec({ html: withCode() }, async ({ page }) => {
    await page.route('**/interactive.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(400);

    const seen = await page.evaluate((a) => ({
      live: document.documentElement.hasAttribute(a),
      control: !!document.querySelector('#cb .copy'),
      code: document.querySelector('#cb pre code')
        .checkVisibility({ contentVisibilityAuto: true }),
      text: document.querySelector('#cb pre code').textContent,
    }), LIVE_ATTR);

    assert.equal(seen.live, false, 'never went live');
    assert.equal(seen.control, false, 'so there is no control');
    assert.equal(seen.code, true, 'and the code is still on the page');
    assert.equal(seen.text, CODE, 'in full');
  });
});

test('the selectors the client is given come from the registry', needsChrome, async () => {
  await withSpec({ html: withCode() }, async ({ page }) => {
    const live = await page.evaluate(() => (window.SPECFORGE || {}).live);
    assert.deepEqual(live, scriptSelectors(), 'no second list on the client');
  });
});

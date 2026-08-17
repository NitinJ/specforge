// Asides, in a real browser.
//
// jsdom says the strip exists and the class flips. It cannot say whether the
// aside reads as attached to the section above it, whether folding it actually
// hides anything, or whether its colours come from the palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withSpec, baseSpec, findCachedChromium, computedAcrossThemes } from './harness.mjs';

const CHROME = findCachedChromium();

const HTML = baseSpec('Asides e2e').replace(
  '<main>',
  '<main>'
  + '<section id="target"><h2>Target</h2><p id="p">The section the aside came from.</p></section>'
  + '<section id="target-aside-1" data-sf-aside="target" data-sf-action="visualize">'
  + '<h3 id="ah">Aside: Visualize</h3><p id="ap">A diagram the agent drafted, with '
  + '<code id="ac">a token</code> in it.</p></section>',
);

// The same markup in the flow, to compare an aside's rendering against. Every
// element in the aside has a twin here that the panel never touches.
const TWIN = HTML.replace(
  '<section id="target">',
  '<section id="twin"><h3 id="th">Aside: Visualize</h3>'
  + '<p id="tp">A diagram the agent drafted, with <code id="tc">a token</code> in it.</p></section>'
  + '<section id="target">',
);

/** Open the panel and wait for the slide to settle, not just for the class. */
async function openPanel(page) {
  await page.click('#target .sf-aside-mark');
  await page.waitForSelector('#sf-asides.open');
  await page.waitForFunction(() => {
    const r = document.getElementById('sf-asides').getBoundingClientRect();
    return r.right <= innerWidth + 1 && r.left < innerWidth - 40;
  });
}

test('the aside renders inside the panel, beside its source section', { skip: !CHROME }, async () => {
  // Was: offset from the section above it, in the flow. The model still stores
  // the aside after its source; only the rendering moved.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    // The panel overlays the page rather than reflowing it, which is what the
    // comments drawer has always done. Inventing a different behaviour for this
    // one panel would be the inconsistency, not the overlay.
    const geom = await page.evaluate(() => {
      const panel = document.getElementById('sf-asides').getBoundingClientRect();
      const aside = document.getElementById('target-aside-1').getBoundingClientRect();
      const drawer = document.getElementById('sf-sidebar').getBoundingClientRect();
      return {
        panelLeft: panel.left, panelRight: panel.right, panelW: panel.width,
        asideLeft: aside.left, asideRight: aside.right, drawerW: drawer.width, vw: innerWidth,
      };
    });
    assert.ok(geom.asideLeft >= geom.panelLeft - 1, 'the aside is inside the panel');
    assert.ok(geom.asideRight <= geom.panelRight + 1, 'and does not spill out of it');
    assert.ok(Math.abs(geom.panelRight - geom.vw) < 2, 'the panel is pinned to the right edge');
    // Half the page at least. It holds one draft at a time and a draft is read
    // rather than skimmed; a diagram in a 340px column is a thumbnail of a
    // decision. Wider than the comments drawer on purpose, so the two are not
    // compared.
    assert.ok(
      geom.panelW >= geom.vw / 2 - 1,
      `panel ${geom.panelW} of viewport ${geom.vw}: it should be at least half`,
    );
  });
});

test('folding the aside actually hides its body', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    assert.equal(await page.locator('#ap').isVisible(), true);
    await page.click('#target-aside-1 .sf-aside-toggle');
    assert.equal(await page.locator('#ap').isVisible(), false, 'hidden');
    assert.equal(await page.locator('#target-aside-1').isVisible(), true, 'the strip stays');
    await page.click('#target-aside-1 .sf-aside-toggle');
    assert.equal(await page.locator('#ap').isVisible(), true, 'and it comes back');
  });
});

test('the aside re-themes, so its colours come from the palette', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    const bg = await computedAcrossThemes(page, '#target-aside-1', 'background-color');
    assert.equal(bg.changed, true, `aside background did not move: ${bg.light} / ${bg.dark}`);
  });
});

test('Import opens the composer, anchored inside the aside', { skip: !CHROME }, async () => {
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    await page.locator('#target-aside-1 .sf-aside-act', { hasText: 'Import' }).click();
    await page.waitForSelector('#sf-rail .sf-bub-compose textarea');
    assert.equal(
      await page.locator('#sf-rail .sf-bub-compose textarea').inputValue(),
      '@import ',
    );
  });
});

test('the aside reads in the spec typography, not the review layer chrome font', { skip: !CHROME }, async () => {
  // An aside IS a section of the spec, so its prose has to render the way the
  // rest of the spec's prose renders. The panel is chrome and carries the review
  // layer's own font; the content inside it is not, and inheriting that font set
  // spec prose at 14px/1.5 where the document says 16px/1.7.
  // Compared element by element against an identical section left in the flow,
  // so this covers the prose, the headings and the monospace runs rather than
  // one paragraph: a spec sets type on all three and the panel must not resize
  // any of them.
  await withSpec({ html: TWIN }, async ({ page }) => {
    await openPanel(page);
    const type = await page.evaluate(() => {
      const pick = (id) => {
        const s = getComputedStyle(document.getElementById(id));
        return {
          family: s.fontFamily, size: s.fontSize, line: s.lineHeight,
          weight: s.fontWeight, color: s.color,
        };
      };
      return {
        heading: [pick('ah'), pick('th')],
        prose: [pick('ap'), pick('tp')],
        code: [pick('ac'), pick('tc')],
      };
    });
    assert.deepEqual(type.prose[0], type.prose[1], 'prose');
    assert.deepEqual(type.heading[0], type.heading[1], 'headings');
    assert.deepEqual(type.code[0], type.code[1], 'monospace runs');
  });
});

test('the panel own chrome keeps the review layer font', { skip: !CHROME }, async () => {
  // The other half of the same rule: the header and the buttons are chrome, and
  // chrome does not inherit the document's reading typography.
  await withSpec({ html: HTML }, async ({ page }) => {
    await openPanel(page);
    const chrome = await page.evaluate(() => {
      const head = getComputedStyle(document.querySelector('.sf-asides-head'));
      const act = getComputedStyle(document.querySelector('.sf-aside-act'));
      const body = getComputedStyle(document.body);
      return {
        headSize: head.fontSize, headFamily: head.fontFamily,
        actSize: act.fontSize, bodySize: body.fontSize,
      };
    });
    assert.notEqual(chrome.headSize, chrome.bodySize, 'the header is sized as chrome');
    assert.match(chrome.headFamily, /system-ui|-apple-system|Segoe UI|Roboto/);
    assert.notEqual(chrome.actSize, chrome.bodySize, 'and so are the buttons');
  });
});

test('Delete removes the aside from the file, through the real endpoint', { skip: !CHROME }, async () => {
  // The one path where a click changes spec.html. Everything below the button is
  // real here: the daemon, the route, the splicer and the file on disk. jsdom
  // can say a DELETE was issued; only this says the section actually left the
  // document and the one it came from did not.
  await withSpec({ html: HTML }, async ({ page, id }) => {
    await openPanel(page);
    await page.locator('#target-aside-1 .sf-aside-act', { hasText: 'Delete' }).click();
    await page.locator('.sfui-dlg[open] .sfui-btn.danger').click();

    // The write triggers the live reload the spec file already has, so the aside
    // goes because it is no longer in the file rather than because the client
    // removed a node.
    await page.waitForFunction(() => !document.getElementById('target-aside-1'));
    assert.ok(await page.$('#target'), 'the section it came from stays');
    assert.equal(await page.$('#sf-asides.open'), null, 'and the panel is not left open on nothing');

    const onDisk = readFileSync(join(process.env.SPECFORGE_HOME, 'specs', id, 'spec.html'), 'utf8');
    assert.equal(onDisk.includes('target-aside-1'), false, 'gone from the file, not just the page');
    assert.equal(onDisk.includes('id="target"'), true);
  });
});

test('the aside carries no table-of-contents entry', { skip: !CHROME }, async () => {
  // It exists until the reader answers it, and the outline is the document's.
  //
  // A spec with its own nav.toc excludes asides by construction, since nothing
  // links them. This drives the OTHER path, where the drawer is built from
  // section[id] and an aside would be listed unless it is filtered out.
  const noNativeToc = `<!doctype html><html><head><title>No TOC</title>
<style>:root{--bg:#fff;--ink:#111;--panel:#f6f6f6;--panel2:#eee;--muted:#666;--line:#ddd;--accent:#2f6feb}
[data-theme="dark"]{--bg:#111;--ink:#eee;--panel:#1a1a1a;--panel2:#222;--muted:#999;--line:#333;--accent:#6ea8fe}</style>
</head><body><main>
<h1>No TOC Spec</h1>
<section id="one"><h2>One</h2><p>First.</p></section>
<section id="two"><h2>Two</h2><p>Second.</p></section>
<section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize"><h3>Aside: Visualize</h3><p>Draft.</p></section>
<section id="three"><h2>Three</h2><p>Third.</p></section>
</main></body></html>`;

  await withSpec({ html: noNativeToc }, async ({ page }) => {
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('#sf-toc a')].map((a) => a.getAttribute('href')));
    assert.deepEqual(hrefs, ['#one', '#two', '#three'], 'the sections, and not the aside');
  });
});

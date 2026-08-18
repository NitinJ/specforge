// The heading scale, as a browser actually resolves it.
//
// The specimen on the library page exists to show every level at its real size,
// which only works if the page renders the family's own CSS. It did not: the
// library page carried a bare `h2{font-size:19px}` of its own for the family
// titles, same specificity as the family's `h2` and later in the sheet, so the
// specimen's "Section" rendered at the page's chrome size and sat a half-pixel
// away from "Subsection". The specimen looked like proof the scale was flat when
// the scale was fine and the page was shadowing it.
//
// No unit test can catch that — it is a cascade outcome across two stylesheets,
// and it is invisible to anything that reads the definitions rather than the
// resolved style. So this asks a real browser, and it asks against
// components/headings.mjs rather than against pinned numbers: retuning the scale
// should not have to touch this file, while anything that shadows it should fail
// here immediately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpec, needsChrome, baseSpec } from './harness.mjs';
import { headings } from '../components/headings.mjs';

/** The px value a family member declares, e.g. 25 for `h2{font-size:25px;…}`. */
function declaredSize(name) {
  const c = headings.find((h) => h.name === name);
  const m = c && /font-size:\s*([\d.]+)px/.exec(c.css);
  assert.ok(m, `${name} declares no px font-size in components/headings.mjs`);
  return Number(m[1]);
}

/** Computed font-size of each level inside the specimen frame. */
async function specimenSizes(page, base) {
  await page.goto(`${base}/components`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cmp-spec');
  return page.evaluate(() => {
    const out = {};
    for (const tag of ['h2', 'h3', 'h4', 'h5']) {
      const el = document.querySelector(`.cmp-spec ${tag}`);
      out[tag] = el ? parseFloat(getComputedStyle(el).fontSize) : null;
    }
    return out;
  });
}

test('the specimen renders each level at the size its family declares', needsChrome, async () => {
  await withSpec({}, async ({ page, base }) => {
    const seen = await specimenSizes(page, base);
    for (const tag of ['h2', 'h3', 'h4', 'h5']) {
      assert.equal(seen[tag], declaredSize(tag),
        `${tag} renders at ${seen[tag]}px but components/headings.mjs declares ${declaredSize(tag)}px — something on the library page is shadowing the family`);
    }
  });
});

test('adjacent levels are far enough apart to read as different levels', needsChrome, async () => {
  // 2px is the floor, not the target. Below it the difference reads as a
  // rendering wobble rather than as hierarchy, which is the state the first
  // version of this family shipped in (h3 16.5px against h4 15px).
  await withSpec({}, async ({ page, base }) => {
    const seen = await specimenSizes(page, base);
    const steps = [['h2', 'h3'], ['h3', 'h4'], ['h4', 'h5']];
    for (const [big, small] of steps) {
      const gap = seen[big] - seen[small];
      assert.ok(gap >= 2, `${big} ${seen[big]}px and ${small} ${seen[small]}px are ${gap}px apart`);
    }
  });
});

// The library page is not where this shipped broken. Every shell carried its own
// h2/h3/h4 after the stamped block, so a real spec rendered the shell's scale and
// the library's was dead on arrival — visible nowhere except by opening a spec.
test('a spec built from the real shell renders the family, not the shell', needsChrome, async () => {
  const html = baseSpec('Heading scale').replace(
    '</main>',
    '<section id="probe"><h2>9 · Probe</h2><h3 id="p3">Sub</h3><h4 id="p4">Deeper</h4><h5 id="p5">Label</h5></section></main>',
  );
  await withSpec({ html }, async ({ page }) => {
    const seen = await page.evaluate(() => {
      const of = (sel) => {
        const s = getComputedStyle(document.querySelector(sel));
        return { size: parseFloat(s.fontSize), color: s.color };
      };
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim();
      const h2 = document.querySelector('#probe h2');
      return {
        h2: of('#probe h2'), h3: of('#p3'), h4: of('#p4'), h5: of('#p5'),
        accent,
        tab: getComputedStyle(h2, '::before').backgroundColor,
      };
    });
    for (const tag of ['h2', 'h3', 'h4', 'h5']) {
      assert.equal(seen[tag].size, declaredSize(tag),
        `${tag} renders at ${seen[tag].size}px, not the declared ${declaredSize(tag)}px`);
    }
    assert.ok(seen.accent, 'the shell defines --accent');
    assert.notEqual(seen.h3.color, seen.h4.color,
      'a subsection is accent and a sub-subsection is ink; equal colors means one of them lost its rule');
    assert.notEqual(seen.tab, 'rgba(0, 0, 0, 0)', 'the section rule carries its accent tab');
  });
});

test('the family titles keep the page chrome scale, not the section scale', needsChrome, async () => {
  // The other half of the fix. Scoping the chrome rule to the family titles is
  // what frees the specimen; if that scoping is ever dropped in the other
  // direction, every family title on the page jumps to section size.
  await withSpec({}, async ({ page, base }) => {
    await page.goto(`${base}/components`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('section[data-family] > h2');
    const title = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('section[data-family] > h2')).fontSize));
    assert.notEqual(title, declaredSize('h2'), 'a family title is page chrome, not a spec section');
  });
});

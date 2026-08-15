// Tests for the harness itself.
//
// A helper that silently reports "nothing changed" would make every theming
// assertion built on it vacuously true, so the helper is held to both halves of
// its claim: it must see a palette-driven colour move, and it must see a
// hard-coded one stay put.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseSpec, withSpec, computedAcrossThemes, needsChrome, findCachedChromium } from './harness.mjs';

/** The base shell with two probes dropped into the overview section. */
function probeSpec() {
  return baseSpec('Harness probe').replace(
    '<section id="overview" data-sf-section>',
    `<section id="overview" data-sf-section>
      <p id="probe-token" style="color:var(--ink)">driven by a palette token</p>
      <p id="probe-fixed" style="color:#ff00ff">hard-coded, and therefore frozen</p>`,
  );
}

test('the harness serves a spec from a throwaway store and boots the review layer', needsChrome, async () => {
  await withSpec({ html: probeSpec(), title: 'Harness probe' }, async ({ page, base, id }) => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
    assert.equal(await page.locator('#sf-launcher').count(), 1, 'review layer injected');
    assert.equal(await page.locator('#probe-token').count(), 1, 'the fixture HTML is what got served');
  });
});

test('computedAcrossThemes sees a palette-driven colour move', needsChrome, async () => {
  await withSpec({ html: probeSpec() }, async ({ page }) => {
    const r = await computedAcrossThemes(page, '#probe-token', 'color');
    assert.ok(r.changed, `expected --ink to differ across themes, got ${r.light} in both`);
    assert.notEqual(r.light, r.dark);
  });
});

test('computedAcrossThemes sees a hard-coded colour stay put', needsChrome, async () => {
  await withSpec({ html: probeSpec() }, async ({ page }) => {
    const r = await computedAcrossThemes(page, '#probe-fixed', 'color');
    assert.equal(r.changed, false, 'a literal colour must not appear to re-theme');
    assert.equal(r.light, 'rgb(255, 0, 255)');
    assert.equal(r.dark, 'rgb(255, 0, 255)');
  });
});

test('computedAcrossThemes restores the theme it found', needsChrome, async () => {
  await withSpec({ html: probeSpec() }, async ({ page }) => {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await computedAcrossThemes(page, '#probe-token', 'color');
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    assert.equal(after, before, 'the page is left on the theme the caller had');
  });
});

test('computedAcrossThemes fails loudly on a selector that matches nothing', needsChrome, async () => {
  await withSpec({ html: probeSpec() }, async ({ page }) => {
    await assert.rejects(
      () => computedAcrossThemes(page, '#not-here', 'color'),
      /no element matches/,
      'a typo in a selector must not read as "nothing changed"',
    );
  });
});

test('a failed probe still leaves the theme it found', needsChrome, async () => {
  await withSpec({ html: probeSpec() }, async ({ page }) => {
    // Deliberately dark. The probe's first read sets 'light' and then throws, so
    // starting from light would make this test pass whether or not anything is
    // restored: there would be nothing to observe.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    await assert.rejects(() => computedAcrossThemes(page, '#not-here', 'color'));

    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    assert.equal(after, 'dark', 'a throwing probe must not strand the page on the theme it was mid-flip to');

    const ok = await computedAcrossThemes(page, '#probe-token', 'color');
    assert.ok(ok.changed, 'and the next probe on the same page still works');
  });
});

test('the browser lookup prefers the newest cached build', () => {
  const exe = findCachedChromium();
  if (!exe) return; // nothing cached; the skip guard covers the rest of the file
  const version = Number(exe.match(/chromium-(\d+)/)[1]);
  assert.ok(Number.isInteger(version) && version > 0, 'resolved a numbered chromium build');
});

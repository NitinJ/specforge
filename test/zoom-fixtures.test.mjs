// The fixtures the full-screen preview is tested against.
//
// Stage 0 of spec 2cc9bae1bc builds three things and asserts them here, so a
// later stage that fails does so because the feature is wrong rather than
// because its fixture never held what it claimed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer, sizeElements, ZOOM_BODY } from './helpers/review-dom.mjs';

test('the fixture holds one of every form the preview must open', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  const one = (sel) => window.document.querySelectorAll(sel).length;

  assert.equal(one('.z-mermaid[data-sf-mermaid="rendered"]'), 1, 'a rendered mermaid diagram');
  assert.equal(one('.z-figure svg'), 1, 'a figure holding inline SVG');
  assert.equal(one('.z-figimg img'), 1, 'a figure holding an image');
  assert.equal(one('.z-img'), 1, 'a bare image');
});

test('and one of every form it must refuse', async (t) => {
  // The refusals carry as much of the contract as the acceptances. A mermaid
  // block that failed to render holds source text, not artwork.
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  assert.equal(window.document.querySelectorAll('.z-mermaid-err[data-sf-mermaid="error"]').length, 1);
  assert.equal(window.document.querySelectorAll('.z-figcaption-only svg, .z-figcaption-only img').length, 0);
  assert.equal(window.document.querySelectorAll('.z-text').length, 1);
});

test('the rendered mermaid block keeps its source, as the renderer leaves it', async (t) => {
  // `data-sf-src` is what the real render writes, and the preview must not need
  // it. Present in the fixture so a test that reaches for it is reaching for
  // something the page actually has.
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  const pre = window.document.querySelector('.z-mermaid');
  assert.match(pre.getAttribute('data-sf-src'), /flowchart LR/);
  assert.equal(pre.querySelectorAll('svg').length, 1, 'and the artwork replaced the source');
});

test('sizeElements gives jsdom the rects it does not compute', async (t) => {
  // Without this every rect is 0x0, and a fit scale computed against zero is the
  // same number whatever the artwork is.
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  const svg = window.document.querySelector('.z-figure svg');
  assert.equal(svg.getBoundingClientRect().width, 0, 'jsdom, before the stub');

  sizeElements(window, { '.z-figure svg': { width: 300, height: 120, x: 10, y: 20 } });
  const r = svg.getBoundingClientRect();
  assert.deepEqual(
    { w: r.width, h: r.height, left: r.left, right: r.right, bottom: r.bottom },
    { w: 300, h: 120, left: 10, right: 310, bottom: 140 },
  );
});

test('it sizes the viewport too, which is the other half of every ratio', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, {}, { width: 1600, height: 900 });
  assert.equal(window.innerWidth, 1600);
  assert.equal(window.innerHeight, 900);
});

test('it sizes every element a selector matches, not only the first', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, { img: { width: 50, height: 40 } });
  const widths = [...window.document.querySelectorAll('img')].map((i) => i.getBoundingClientRect().width);
  assert.ok(widths.length > 1, 'the fixture has only one image to size');
  assert.deepEqual(widths, widths.map(() => 50));
});

test('the harness can boot without the zoom modules', async (t) => {
  // Three invariants are about review.js surviving a zoom module that is absent
  // or broken. A harness that always loaded it could express none of them.
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY, noZoom: true });
  assert.equal(window.SFZoom, undefined);
  assert.equal(window.SFZoomView, undefined);
  assert.ok(window.document.getElementById('sf-sidebar'), 'and the review layer still booted');
});

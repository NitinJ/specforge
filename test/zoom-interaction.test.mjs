// Zooming and panning the preview.
//
// Stage 3 connects the view maths to the overlay. The maths itself is covered in
// zoom-view.test.mjs; what is asserted here is that each input reaches it and
// that the result lands on the transform.
//
// Spec 2cc9bae1bc, stage 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer, sizeElements, ZOOM_BODY } from './helpers/review-dom.mjs';

const settle = (window) => new Promise((r) => window.setTimeout(r, 0));

/** Open the preview on the fixture's mermaid diagram, at a known size. */
async function opened(t, selector = '.z-mermaid') {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, {
    '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 },
    '.z-figure': { width: 820, height: 140, x: 100, y: 600 },
  }, { width: 1600, height: 900 });
  window.SFZoom.open(window.document.querySelector(selector));
  await settle(window);
  return window;
}

const holderOf = (window) => window.document.querySelector('.sf-zoom-art');

/** The numbers currently on the transform. */
function view(window) {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/
    .exec(holderOf(window).style.transform);
  if (!m) throw new Error(`no transform: ${holderOf(window).style.transform}`);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

function wheel(window, deltaY, at = { x: 800, y: 450 }) {
  holderOf(window).dispatchEvent(new window.WheelEvent('wheel', {
    deltaY, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true,
  }));
}

function drag(window, from, to) {
  const h = holderOf(window);
  h.dispatchEvent(new window.MouseEvent('pointerdown', {
    clientX: from.x, clientY: from.y, bubbles: true, button: 0,
  }));
  window.document.dispatchEvent(new window.MouseEvent('pointermove', {
    clientX: to.x, clientY: to.y, bubbles: true,
  }));
  window.document.dispatchEvent(new window.MouseEvent('pointerup', {
    clientX: to.x, clientY: to.y, bubbles: true,
  }));
}

// --- opening ------------------------------------------------------------------

test('it opens at fit, centred', async (t) => {
  const window = await opened(t);
  const v = view(window);
  // The fixture's viewBox is 400x200, which fits inside 1600x900 at 1.
  assert.equal(v.scale, 1);
  assert.equal(v.x, (1600 - 400) / 2);
  assert.equal(v.y, (900 - 200) / 2);
});

// --- the wheel -----------------------------------------------------------------

test('scrolling up zooms in, scrolling down zooms out', async (t) => {
  const window = await opened(t);
  const start = view(window).scale;
  wheel(window, -240);
  const zoomedIn = view(window).scale;
  assert.ok(zoomedIn > start, `${start} -> ${zoomedIn}`);

  wheel(window, 240);
  assert.ok(view(window).scale < zoomedIn);
});

test('the point under the pointer stays under it', async (t) => {
  // The whole contract of an anchored zoom, asserted through the DOM rather
  // than only over the numbers.
  const window = await opened(t);
  const at = { x: 700, y: 500 };
  const before = view(window);
  wheel(window, -300, at);
  const after = view(window);

  const pre = { x: (at.x - before.x) / before.scale, y: (at.y - before.y) / before.scale };
  const post = { x: (at.x - after.x) / after.scale, y: (at.y - after.y) / after.scale };
  assert.ok(Math.abs(pre.x - post.x) < 0.01, `x moved: ${pre.x} -> ${post.x}`);
  assert.ok(Math.abs(pre.y - post.y) < 0.01, `y moved: ${pre.y} -> ${post.y}`);
});

test('the wheel is consumed, so the document behind does not scroll', async (t) => {
  // Without preventDefault the page scrolls under the overlay, and closing it
  // leaves the reader somewhere they did not choose.
  const window = await opened(t);
  const e = new window.WheelEvent('wheel', { deltaY: -120, clientX: 800, clientY: 450, bubbles: true, cancelable: true });
  holderOf(window).dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
});

test('zooming stops at 8x however long the reader scrolls', async (t) => {
  const window = await opened(t);
  for (let i = 0; i < 60; i++) wheel(window, -240);
  assert.ok(view(window).scale <= 8.0001, `ran away to ${view(window).scale}`);
});

test('zooming out stops at half of fit', async (t) => {
  const window = await opened(t);
  const fit = view(window).scale;
  for (let i = 0; i < 60; i++) wheel(window, 240);
  assert.ok(view(window).scale >= fit / 2 - 0.0001, `shrank past the bound to ${view(window).scale}`);
});

// --- dragging -------------------------------------------------------------------

test('dragging moves the artwork with the pointer', async (t) => {
  const window = await opened(t);
  wheel(window, -400); // past fit, so there is somewhere to pan to
  const before = view(window);
  drag(window, { x: 800, y: 450 }, { x: 700, y: 400 });
  const after = view(window);
  assert.ok(Math.abs((after.x - before.x) - -100) < 0.01, `x: ${before.x} -> ${after.x}`);
  assert.ok(Math.abs((after.y - before.y) - -50) < 0.01, `y: ${before.y} -> ${after.y}`);
});

test('a drag cannot push the artwork off the screen', async (t) => {
  const window = await opened(t);
  drag(window, { x: 800, y: 450 }, { x: -90000, y: -90000 });
  const v = view(window);
  const painted = { w: 400 * v.scale, h: 200 * v.scale };
  assert.ok(v.x + painted.w >= 60, `left the viewport: right edge at ${v.x + painted.w}`);
  assert.ok(v.y + painted.h >= 60, `left the viewport: bottom edge at ${v.y + painted.h}`);
});

test('the drag ends when the pointer is released', async (t) => {
  const window = await opened(t);
  drag(window, { x: 800, y: 450 }, { x: 700, y: 450 });
  const settled = view(window);
  // A move after the release must not still be dragging.
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 100, clientY: 100, bubbles: true }));
  assert.deepEqual(view(window), settled);
});

test('dragging marks the artwork, so the cursor can say so', async (t) => {
  const window = await opened(t);
  const h = holderOf(window);
  h.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 800, clientY: 450, bubbles: true, button: 0 }));
  assert.ok(h.classList.contains('sf-zoom-dragging'));
  window.document.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 800, clientY: 450, bubbles: true }));
  assert.equal(h.classList.contains('sf-zoom-dragging'), false);
});

// --- double-click ----------------------------------------------------------------

test('double-clicking toggles between fit and 2x', async (t) => {
  const window = await opened(t);
  const fit = view(window).scale;

  holderOf(window).dispatchEvent(new window.MouseEvent('dblclick', { clientX: 800, clientY: 450, bubbles: true }));
  assert.ok(Math.abs(view(window).scale - 2) < 0.0001, `expected 2x, got ${view(window).scale}`);

  holderOf(window).dispatchEvent(new window.MouseEvent('dblclick', { clientX: 800, clientY: 450, bubbles: true }));
  assert.ok(Math.abs(view(window).scale - fit) < 0.0001, `expected fit, got ${view(window).scale}`);
});

// --- the controls -----------------------------------------------------------------

const control = (window, name) => window.document.querySelector('.sf-zoom-' + name);

test('the control strip offers out, reset, in and a readout', async (t) => {
  const window = await opened(t);
  assert.ok(control(window, 'out'), 'no zoom-out');
  assert.ok(control(window, 'reset'), 'no reset');
  assert.ok(control(window, 'in'), 'no zoom-in');
  assert.ok(control(window, 'level'), 'no readout');
});

test('the buttons step the scale', async (t) => {
  const window = await opened(t);
  const start = view(window).scale;
  control(window, 'in').click();
  const bigger = view(window).scale;
  assert.ok(bigger > start, `${start} -> ${bigger}`);
  control(window, 'out').click();
  assert.ok(Math.abs(view(window).scale - start) < 0.0001, 'out did not undo in');
});

test('reset returns to exactly fit, re-centred', async (t) => {
  const window = await opened(t);
  const fit = view(window);
  wheel(window, -600);
  drag(window, { x: 800, y: 450 }, { x: 400, y: 200 });
  control(window, 'reset').click();
  assert.deepEqual(view(window), fit);
});

test('the readout says what the scale is', async (t) => {
  const window = await opened(t);
  assert.equal(control(window, 'level').textContent, '100%');
  control(window, 'in').click();
  assert.notEqual(control(window, 'level').textContent, '100%');
  assert.match(control(window, 'level').textContent, /^\d+%$/);
});

test('the controls do not close the preview', async (t) => {
  // They sit over the backdrop, whose click closes.
  const window = await opened(t);
  control(window, 'in').click();
  await settle(window);
  assert.ok(window.document.getElementById('sf-zoom'), 'a control closed the preview');
});

// --- what stage 3 must not break ---------------------------------------------------

test('the document is still untouched after zooming and panning', async (t) => {
  // I1 again, now with interaction on top: the transform is written to the
  // overlay's own holder, and nothing in the document moves.
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 } },
    { width: 1600, height: 900 });
  const before = window.document.querySelector('main').innerHTML;

  window.SFZoom.open(window.document.querySelector('.z-mermaid'));
  await settle(window);
  wheel(window, -400);
  drag(window, { x: 800, y: 450 }, { x: 600, y: 300 });
  window.SFZoom.close();
  await settle(window);

  assert.equal(window.document.querySelector('main').innerHTML, before);
});

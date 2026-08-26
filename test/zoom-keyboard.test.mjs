// Using the preview without a mouse.
//
// E5: the preview takes focus, holds it while open, and gives it back. A reader
// who navigates by keyboard must be able to open a diagram, enlarge it, move
// around it and leave, without ever being dropped at the top of the document.
//
// Spec 2cc9bae1bc, stage 4.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer, sizeElements, ZOOM_BODY } from './helpers/review-dom.mjs';

const settle = (window) => new Promise((r) => window.setTimeout(r, 0));

async function opened(t) {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 } },
    { width: 1600, height: 900 });
  window.document.querySelector('.z-mermaid')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  window.document.getElementById('sf-zoom-btn').click();
  await settle(window);
  return window;
}

const overlay = (window) => window.document.getElementById('sf-zoom');
const holder = (window) => window.document.querySelector('.sf-zoom-art');

function key(window, k, opts = {}) {
  overlay(window).dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...opts,
  }));
}

function view(window) {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/
    .exec(holder(window).style.transform);
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

// --- focus ----------------------------------------------------------------------

test('the preview takes focus when it opens', async (t) => {
  // Without this a keyboard reader opens a picture and their keys still go to
  // the document behind it.
  const window = await opened(t);
  assert.ok(
    overlay(window).contains(window.document.activeElement),
    `focus went to ${window.document.activeElement && window.document.activeElement.id}`,
  );
});

test('focus returns to the trigger when it closes', async (t) => {
  // I7. Otherwise a keyboard reader is dropped at the top of the document every
  // time they close a picture.
  const window = await opened(t);
  window.SFZoom.close();
  await settle(window);
  assert.equal(window.document.activeElement.id, 'sf-zoom-btn');
});

test('focus returns even though the hover cleared while it was open', async (t) => {
  // The case jsdom missed and a browser caught: opening the preview puts the
  // pointer over the overlay, review.js clears its hover, and the trigger hides.
  // Focusing a hidden button does nothing, and the reader lands back at the top
  // of the document.
  const window = await opened(t);
  window.SFZoom.hover(null); // what review.js does when the pointer leaves
  assert.equal(window.document.getElementById('sf-zoom-btn').hidden, true);

  window.SFZoom.close();
  await settle(window);
  assert.equal(window.document.getElementById('sf-zoom-btn').hidden, false, 'still hidden');
  assert.equal(window.document.activeElement.id, 'sf-zoom-btn');
});

test('Tab from the last control returns to the first', async (t) => {
  // A modal that lets Tab escape into the document behind it is a modal in
  // appearance only.
  const window = await opened(t);
  const focusable = [...overlay(window).querySelectorAll('button')];
  assert.ok(focusable.length >= 2, 'nothing to trap');

  focusable[focusable.length - 1].focus();
  key(window, 'Tab');
  assert.equal(window.document.activeElement, focusable[0], 'Tab escaped the preview');
});

test('Shift+Tab from the first control wraps to the last', async (t) => {
  const window = await opened(t);
  const focusable = [...overlay(window).querySelectorAll('button')];
  focusable[0].focus();
  key(window, 'Tab', { shiftKey: true });
  assert.equal(window.document.activeElement, focusable[focusable.length - 1]);
});

// --- the keys ---------------------------------------------------------------------

test('plus and minus zoom, and zero fits', async (t) => {
  const window = await opened(t);
  const fit = view(window).scale;

  key(window, '+');
  assert.ok(view(window).scale > fit, 'plus did not zoom in');

  key(window, '-');
  assert.ok(Math.abs(view(window).scale - fit) < 0.0001, 'minus did not undo plus');

  key(window, '+');
  key(window, '+');
  key(window, '0');
  assert.ok(Math.abs(view(window).scale - fit) < 0.0001, 'zero did not return to fit');
});

test('the equals key zooms in too, since plus needs a shift on most layouts', async (t) => {
  const window = await opened(t);
  const fit = view(window).scale;
  key(window, '=');
  assert.ok(view(window).scale > fit);
});

test('the arrows move the picture', async (t) => {
  const window = await opened(t);
  key(window, '+');
  key(window, '+'); // past fit, so there is somewhere to move to
  const before = view(window);

  key(window, 'ArrowRight');
  assert.ok(view(window).x < before.x, 'right did not move the picture left');

  key(window, 'ArrowLeft');
  assert.ok(Math.abs(view(window).x - before.x) < 0.0001, 'left did not undo right');

  key(window, 'ArrowDown');
  assert.ok(view(window).y < before.y, 'down did not move the picture up');
});

test('every handled key is consumed, so the document behind does not act on it', async (t) => {
  // Arrow keys scroll a page. A reader panning a diagram must not also be
  // scrolling the document they will return to.
  const window = await opened(t);
  for (const k of ['+', '-', '=', '0', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    overlay(window).dispatchEvent(e);
    assert.equal(e.defaultPrevented, true, `${k} was not consumed`);
  }
});

test('the other keys that scroll a document are consumed as well', async (t) => {
  // Page Down, Home, End and Space scroll a page. They do nothing in the
  // preview, and a reader who presses one must not find the document moved
  // when they close it.
  const window = await opened(t);
  for (const k of ['PageUp', 'PageDown', 'Home', 'End', ' ']) {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    overlay(window).dispatchEvent(e);
    assert.equal(e.defaultPrevented, true, `${k} was not consumed`);
  }
});

test('a key it does not handle is left alone', async (t) => {
  const window = await opened(t);
  const e = new window.KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
  overlay(window).dispatchEvent(e);
  assert.equal(e.defaultPrevented, false);
});

test('keyboard zoom obeys the same bounds as the wheel', async (t) => {
  const window = await opened(t);
  for (let i = 0; i < 40; i++) key(window, '+');
  assert.ok(view(window).scale <= 8.0001, `ran away to ${view(window).scale}`);
});

test('arrows cannot push the picture off the screen', async (t) => {
  const window = await opened(t);
  for (let i = 0; i < 200; i++) key(window, 'ArrowRight');
  const v = view(window);
  assert.ok(v.x <= 1600 - 60, `left the viewport at x=${v.x}`);
});

// --- what it announces --------------------------------------------------------------

test('the preview names what it is showing', async (t) => {
  const window = await opened(t);
  assert.equal(overlay(window).getAttribute('role'), 'dialog');
  assert.equal(overlay(window).getAttribute('aria-modal'), 'true');
  assert.match(overlay(window).getAttribute('aria-label'), /diagram/i);
});

test('a captioned figure is announced by its caption', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, {}, { width: 1600, height: 900 });
  window.SFZoom.open(window.document.querySelector('.z-figure'));
  await settle(window);
  assert.equal(overlay(window).getAttribute('aria-label'), 'A hand-drawn picture.');
});

test('an image is announced by its alt text', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, {}, { width: 1600, height: 900 });
  window.SFZoom.open(window.document.querySelector('.z-img'));
  await settle(window);
  assert.equal(overlay(window).getAttribute('aria-label'), 'A bare image');
});

test('the trigger says what it does', async (t) => {
  const { window } = await bootReviewLayer(t, { body: ZOOM_BODY });
  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 } },
    { width: 1600, height: 900 });
  window.document.querySelector('.z-mermaid')
    .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  const btn = window.document.getElementById('sf-zoom-btn');
  assert.match(btn.getAttribute('aria-label'), /full screen/i);
});

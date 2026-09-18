// The child panel's width: dragged from its left edge, stepped with the arrow
// keys, reset with a double-click, and remembered for every spec.
//
// jsdom runs no layout, so every width here is the inline style the client
// writes. That is the thing the stylesheet reads, so it is the thing to assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer } from './helpers/review-dom.mjs';

const ROWS = [{
  id: 'aaa1111111', title: 'Code grounding', type: 'research', status: 'draft',
  comments: { open: 0, total: 0 }, hasChildren: false,
}];

async function openChild(window) {
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  rows.find((el) => /Child specs/.test(el.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
  window.document.querySelector('#sf-children .sf-child-row').click();
  await new Promise((r) => window.setTimeout(r, 0));
}

const panel = (w) => w.document.querySelector('#sf-child-panel');
const handle = (w) => w.document.querySelector('#sf-child-panel .sf-child-resize');
const stored = (w, key = 'sf-prefs') => {
  try { return JSON.parse(w.localStorage.getItem(key) || '{}'); } catch { return {}; }
};

/** A drag: press on the handle at `from`, move the window to `to`, release. */
function drag(w, from, to, { release = true } = {}) {
  handle(w).dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: from }));
  w.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: to }));
  if (release) w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: to }));
}

function key(w, k, shiftKey = false) {
  handle(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
}

test('the panel\'s left edge is a resize handle a keyboard can reach', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window);
  const h = handle(window);
  assert.ok(h, 'no resize handle on the child panel');
  assert.equal(h.getAttribute('role'), 'separator');
  assert.equal(h.getAttribute('aria-orientation'), 'vertical');
  assert.equal(h.getAttribute('tabindex'), '0');
});

test('dragging the edge left widens the panel, and the width is remembered', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  assert.equal(panel(window).style.width, '500px', 'a saved width applies when the panel is built');

  drag(window, 700, 500, { release: false });
  assert.equal(panel(window).style.width, '700px');
  assert.ok(window.document.body.classList.contains('sf-child-resizing'),
    'while dragging, the frame must ignore the pointer or the drag stops at its edge');

  window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 500 }));
  assert.equal(window.document.body.classList.contains('sf-child-resizing'), false);
  assert.equal(stored(window).childW, 700);
});

test('it never gets narrower than a readable minimum', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  drag(window, 500, 900);
  assert.equal(panel(window).style.width, '360px');
});

test('it never covers the whole parent: a strip of the page stays on the left', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  drag(window, 700, -2000);
  // jsdom's window is 1024 wide; 120px of the parent stays visible.
  assert.equal(panel(window).style.width, '904px');
});

test('arrow keys resize in steps, with Shift for bigger ones', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  key(window, 'ArrowLeft');
  assert.equal(panel(window).style.width, '524px', 'left widens, since the panel is anchored right');
  key(window, 'ArrowRight');
  assert.equal(panel(window).style.width, '500px');
  key(window, 'ArrowLeft', true);
  assert.equal(panel(window).style.width, '580px');
  assert.equal(stored(window).childW, 580);
});

test('double-click resets to the default width and forgets the saved one', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  handle(window).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(panel(window).style.width, '', 'back to the stylesheet default');
  assert.equal(stored(window).childW, null);
});

test('the width is a reading preference: stored store-wide, not for this spec alone', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 } });
  await openChild(window);
  drag(window, 700, 600);
  assert.equal(stored(window).childW, 600);
  assert.equal(stored(window, 'sf-prefs:test-spec').childW, undefined);
});

test('a saved width wider than a smaller window is clamped to it', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 1500 }, innerWidth: 1000 });
  await openChild(window);
  assert.equal(panel(window).style.width, '880px');
});

test('on a narrow window the panel stays full-screen and the handle does nothing', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { childW: 500 }, innerWidth: 800 });
  await openChild(window);
  assert.equal(panel(window).style.width, '', 'a desktop width would fight the full-screen layout');
  drag(window, 700, 400);
  key(window, 'ArrowLeft');
  assert.equal(panel(window).style.width, '');
});

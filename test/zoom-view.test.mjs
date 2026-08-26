// The view maths behind the full-screen preview.
//
// Scale and offset, as pure functions over numbers. Separated from the overlay
// because this is the part with edge cases (artwork with no size, a viewport
// smaller than its own inset) and the part a DOM test would exercise only by
// accident.
//
// Spec 2cc9bae1bc, stage 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Load the module the way a browser does: a plain script setting a global. */
function loadView() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
  dom.window.eval(readFileSync(join(ROOT, 'server', 'public', 'zoom-view.js'), 'utf8'));
  return dom.window.SFZoomView;
}

const V = loadView();
const art = (width, height) => ({ width, height });
const port = (width, height) => ({ width, height });

// --- fit ---------------------------------------------------------------------

test('fit scales artwork down to sit inside the viewport, with an inset', () => {
  // 1600x900 viewport, inset 48 on each side, so the usable box is 1504x804.
  assert.equal(V.fit(art(3008, 800), port(1600, 900)), 0.5, 'width is the binding axis');
  assert.equal(V.fit(art(800, 1608), port(1600, 900)), 0.5, 'height is the binding axis');
});

test('fit never exceeds 1, so a small picture is not blown up on arrival', () => {
  // D6. A 40x40 icon centred at 20x would be a wall of blur, and the reader
  // never asked for it.
  assert.equal(V.fit(art(40, 40), port(1600, 900)), 1);
  assert.equal(V.fit(art(1, 1), port(1600, 900)), 1);
});

test('fit answers 1 for artwork with no measurable size', () => {
  // An SVG with no intrinsic size reports 0x0 in some browsers. Dividing by it
  // yields Infinity, and a transform of Infinity paints nothing at all.
  assert.equal(V.fit(art(0, 0), port(1600, 900)), 1);
  assert.equal(V.fit(art(0, 500), port(1600, 900)), 1);
  assert.equal(V.fit(art(500, 0), port(1600, 900)), 1);
});

test('fit survives a viewport smaller than its own inset', () => {
  // A 60x60 viewport leaves a usable box of -36. Scale must stay positive, or
  // the artwork is drawn inside out.
  const s = V.fit(art(400, 400), port(60, 60));
  assert.ok(s > 0 && s <= 1, `expected a positive scale, got ${s}`);
});

// --- zoomAt ------------------------------------------------------------------

test('zooming holds the anchored point still', () => {
  // The whole contract of an anchored zoom: the pixel under the cursor is the
  // same pixel after the wheel turns.
  const before = { scale: 1, x: 0, y: 0 };
  const anchor = { x: 400, y: 300 };
  const after = V.zoomAt(before, 2, anchor, { min: 0.1, max: 8 });

  // The artwork point under the anchor, before and after.
  const pre = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale };
  const post = { x: (anchor.x - after.x) / after.scale, y: (anchor.y - after.y) / after.scale };
  assert.ok(Math.abs(pre.x - post.x) < 0.001, `x moved: ${pre.x} -> ${post.x}`);
  assert.ok(Math.abs(pre.y - post.y) < 0.001, `y moved: ${pre.y} -> ${post.y}`);
});

test('zooming clamps to the given bounds', () => {
  const start = { scale: 1, x: 0, y: 0 };
  assert.equal(V.zoomAt(start, 100, { x: 0, y: 0 }, { min: 0.5, max: 8 }).scale, 8);
  assert.equal(V.zoomAt(start, 0.001, { x: 0, y: 0 }, { min: 0.5, max: 8 }).scale, 0.5);
});

test('a zoom that hits the clamp still holds its anchor', () => {
  // The defect this prevents: clamping the scale after computing the offset from
  // the unclamped one, which slides the artwork sideways at the bound.
  const before = { scale: 4, x: -100, y: -50 };
  const anchor = { x: 300, y: 200 };
  const after = V.zoomAt(before, 100, anchor, { min: 0.5, max: 8 });

  assert.equal(after.scale, 8);
  const pre = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale };
  const post = { x: (anchor.x - after.x) / after.scale, y: (anchor.y - after.y) / after.scale };
  assert.ok(Math.abs(pre.x - post.x) < 0.001, `x moved at the bound: ${pre.x} -> ${post.x}`);
});

test('a factor of 1 changes nothing', () => {
  const v = { scale: 2.5, x: 30, y: -12 };
  assert.deepEqual(V.zoomAt(v, 1, { x: 100, y: 100 }, { min: 0.1, max: 8 }), v);
});

// --- clamp -------------------------------------------------------------------

test('clamp keeps the artwork overlapping the viewport', () => {
  // Panned far off to the left: the artwork must still show its minimum overlap
  // rather than leaving the screen with no way back except closing.
  const v = { scale: 1, x: -100000, y: 0 };
  const out = V.clamp(v, art(400, 300), port(1600, 900));
  const right = out.x + 400 * out.scale;
  assert.ok(right >= V.MIN_OVERLAP, `artwork left the viewport: right edge at ${right}`);
});

test('clamp works in all four directions', () => {
  const a = art(400, 300);
  const p = port(1600, 900);
  const far = 100000;

  const left = V.clamp({ scale: 1, x: -far, y: 0 }, a, p);
  assert.ok(left.x + 400 >= V.MIN_OVERLAP);

  const rightOut = V.clamp({ scale: 1, x: far, y: 0 }, a, p);
  assert.ok(rightOut.x <= 1600 - V.MIN_OVERLAP);

  const up = V.clamp({ scale: 1, x: 0, y: -far }, a, p);
  assert.ok(up.y + 300 >= V.MIN_OVERLAP);

  const down = V.clamp({ scale: 1, x: 0, y: far }, a, p);
  assert.ok(down.y <= 900 - V.MIN_OVERLAP);
});

test('clamp leaves a view already inside the viewport alone', () => {
  // Field by field: the module runs inside the jsdom realm, so the object it
  // returns has jsdom's Object prototype and deepStrictEqual compares those.
  const v = { scale: 1, x: 600, y: 300 };
  const out = V.clamp(v, art(400, 300), port(1600, 900));
  assert.deepEqual({ scale: out.scale, x: out.x, y: out.y }, v);
});

test('clamp accounts for scale, not only size', () => {
  // 400px of artwork at 8x is 3200px on screen, and the bound is about the
  // painted size rather than the natural one.
  const v = { scale: 8, x: -3000, y: 0 };
  const out = V.clamp(v, art(400, 300), port(1600, 900));
  assert.ok(out.x + 400 * 8 >= V.MIN_OVERLAP);
});

test('clamp does not divide by zero on artwork with no size', () => {
  const out = V.clamp({ scale: 1, x: 50, y: 50 }, art(0, 0), port(1600, 900));
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y));
});

// --- I6, as a property --------------------------------------------------------

test('scale and overlap hold across long random sequences', () => {
  // I6. Written as a sequence rather than a single call because the failure this
  // catches is cumulative: an offset that drifts a little on each step is inside
  // its bound every time and outside it after thirty.
  const a = art(900, 640);
  const p = port(1440, 810);
  const base = V.fit(a, p);
  const bounds = { min: base / 2, max: 8 };

  let seed = 20260826;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  let v = { scale: base, x: 0, y: 0 };
  for (let i = 0; i < 200; i++) {
    const anchor = { x: rand() * p.width, y: rand() * p.height };
    v = V.zoomAt(v, 0.4 + rand() * 3, anchor, bounds);
    v = V.clamp({ ...v, x: v.x + (rand() - 0.5) * 4000, y: v.y + (rand() - 0.5) * 4000 }, a, p);

    assert.ok(v.scale >= bounds.min - 1e-9 && v.scale <= bounds.max + 1e-9,
      `step ${i}: scale ${v.scale} outside [${bounds.min}, ${bounds.max}]`);
    assert.ok(v.x + a.width * v.scale >= V.MIN_OVERLAP - 1e-6 && v.x <= p.width - V.MIN_OVERLAP + 1e-6,
      `step ${i}: x ${v.x} left the viewport`);
    assert.ok(v.y + a.height * v.scale >= V.MIN_OVERLAP - 1e-6 && v.y <= p.height - V.MIN_OVERLAP + 1e-6,
      `step ${i}: y ${v.y} left the viewport`);
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.scale),
      `step ${i}: view went non-finite`);
  }
});

// --- the module itself ---------------------------------------------------------

test('it needs no DOM, because a subprocess and a test both load it bare', () => {
  const names = Object.keys(V).sort();
  assert.deepEqual(names, ['INSET', 'MIN_OVERLAP', 'centre', 'clamp', 'fit', 'zoomAt']);
});

test('centre puts the artwork in the middle of the viewport', () => {
  const c = V.centre(art(400, 200), port(1600, 900), 0.5);
  assert.equal(c.x, (1600 - 200) / 2);
  assert.equal(c.y, (900 - 100) / 2);
});

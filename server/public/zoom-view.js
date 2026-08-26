/**
 * The view maths behind the full-screen preview: scale and offset, as numbers.
 *
 * No DOM. Everything here is arithmetic over two rectangles, which is what lets
 * the edge cases be tested directly: artwork that reports no size, a viewport
 * smaller than its own inset, and an anchored zoom that lands on its bound.
 *
 * A "view" is `{ scale, x, y }`. It is applied to the clone as one
 * `transform: translate(x, y) scale(s)`, so the browser composites the picture
 * rather than re-laying-out an SVG on every frame.
 *
 * Spec 2cc9bae1bc, stage 1.
 */
(function (global) {
  'use strict';

  /** Breathing room around the artwork at fit, per side, in CSS pixels. */
  var INSET = 48;

  /**
   * How much of the artwork must stay on screen, in CSS pixels.
   *
   * Without a floor a reader can drag the picture off the edge and have no way
   * back except closing the preview, which loses their zoom as well.
   */
  var MIN_OVERLAP = 64;

  /** Keep `n` inside [lo, hi]. */
  function bound(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /**
   * The scale at which the artwork sits entirely inside the viewport.
   *
   * Never above 1: a 40px icon painted at 20x is a wall of blur, and the reader
   * asked to see the picture rather than its pixels (D6). Zooming past 1 is
   * available, and deliberate.
   *
   * Artwork with no measurable size answers 1 rather than Infinity. An SVG with
   * no intrinsic dimensions reports 0x0 in some browsers, and a transform of
   * Infinity paints nothing at all.
   */
  function fit(art, viewport) {
    if (!art || !art.width || !art.height) return 1;
    // A viewport narrower than twice the inset would give a negative box, and a
    // negative scale draws the artwork inside out.
    var usableW = Math.max(1, viewport.width - INSET * 2);
    var usableH = Math.max(1, viewport.height - INSET * 2);
    return Math.min(1, usableW / art.width, usableH / art.height);
  }

  /** The offset that centres artwork of this size at this scale. */
  function centre(art, viewport, scale) {
    return {
      x: (viewport.width - art.width * scale) / 2,
      y: (viewport.height - art.height * scale) / 2,
    };
  }

  /**
   * Scale by `factor`, holding the point under `anchor` still.
   *
   * The offset is computed from the CLAMPED scale, not the requested one. Doing
   * it the other way round looks correct until the zoom lands on its bound, at
   * which point the picture slides sideways under a cursor that did not move.
   */
  function zoomAt(view, factor, anchor, bounds) {
    var next = bound(view.scale * factor, bounds.min, bounds.max);
    if (next === view.scale) return view;
    // The artwork coordinate currently under the anchor. Solving for the offset
    // that keeps it there at the new scale gives the two lines below.
    var ratio = next / view.scale;
    return {
      scale: next,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    };
  }

  /**
   * Pull an offset back until the artwork still overlaps the viewport.
   *
   * Measured against the PAINTED size (natural size times scale), because 400px
   * of artwork at 8x is 3200px on screen and the bound is about what the reader
   * can see.
   */
  function clamp(view, art, viewport) {
    var w = (art.width || 0) * view.scale;
    var h = (art.height || 0) * view.scale;
    return {
      scale: view.scale,
      x: bound(view.x, MIN_OVERLAP - w, viewport.width - MIN_OVERLAP),
      y: bound(view.y, MIN_OVERLAP - h, viewport.height - MIN_OVERLAP),
    };
  }

  global.SFZoomView = {
    INSET: INSET,
    MIN_OVERLAP: MIN_OVERLAP,
    fit: fit,
    centre: centre,
    zoomAt: zoomAt,
    clamp: clamp,
  };
}(typeof window !== 'undefined' ? window : globalThis));

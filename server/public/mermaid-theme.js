// Author-chosen diagram colours, adapted to the theme the reader is in.
//
// review.css themes a rendered diagram through selectors on its block, and that
// covers everything mermaid draws from its own palette. It cannot reach a colour
// the author chose: `style X fill:#dbeafe` and `classDef layer fill:#E9D5FF`
// both land as an inline `style` attribute carrying `!important`, which no
// stylesheet outranks. 21 of the 80 diagrams in this store do that, in 28
// distinct hex values, every one of them picked while looking at a light page.
// In dark those nodes stayed pale: a light-mode island in the middle of a dark
// document.
//
// Stripping them was the other option and it is wrong, because the colour is
// usually the diagram's legend. One spec says it outright: "a box's fill colour
// always says which layer its entity belongs to". Dropping the fills would make
// every box the same and delete what the sentence refers to.
//
// So the hue is kept and the lightness is flipped. A pale lavender fill becomes
// a deep lavender, its dark violet border becomes a light one, and the two are
// still lavender: the legend reads in both themes, and the reader can still tell
// the lavender boxes from the blue ones.
//
// The colour on the label is a separate problem with the same cause. Mermaid
// writes a classDef's `color` into its own stylesheet rather than the element,
// and a spec that labels its nodes with HTML styles those labels from the page's
// stylesheet, so neither is reachable by reading style attributes. Those are
// found by measuring what is rendered: any text inside a diagram that does not
// clear 4.5:1 against what it is drawn on is lifted until it does, and text that
// already reads is not touched.
//
// Pure functions, no DOM, so the maths is testable without a browser. review.js
// walks the SVG and calls in.

(function (global) {
  /** Parse #rgb, #rrggbb, rgb() or rgba() into [r,g,b]. Null for anything else. */
  function toRgb(value) {
    var s = String(value == null ? '' : value).trim().toLowerCase();
    var hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
      var h = hex[1];
      // #rgb and #rgba expand each digit; the alpha digits are dropped, because
      // this only rewrites the colour and leaves opacity to the element.
      if (h.length <= 4) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var fn = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
    return null;
  }

  /**
   * The alpha of a colour, 0 to 1, and 1 for anything opaque or unparseable.
   *
   * Kept apart from toRgb so the channel triple stays a triple. Alpha is
   * load-bearing here: a chip drawn as `rgba(255,255,255,.6)` is a translucent
   * pill over whatever the node is filled with, and returning it opaque would
   * paint a solid badge where the author drew a wash.
   */
  function alphaOf(value) {
    var s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'transparent') return 0;
    var hex = s.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/);
    if (hex) {
      var h = hex[1];
      if (h.length === 4) return parseInt(h[3] + h[3], 16) / 255;
      return parseInt(h.slice(6, 8), 16) / 255;
    }
    var fn = s.match(/^rgba\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,/]+([\d.]+)/);
    return fn ? Number(fn[1]) : 1;
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255; var g = rgb[1] / 255; var b = rgb[2] / 255;
    var max = Math.max(r, g, b); var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    var d = max - min;
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }

  function hslToCss(hsl, alpha) {
    var head = Math.round(hsl[0] * 360) + ',' + Math.round(hsl[1] * 100) + '%,'
      + Math.round(hsl[2] * 100) + '%';
    if (alpha == null || alpha >= 1) return 'hsl(' + head + ')';
    return 'hsla(' + head + ',' + Math.round(alpha * 100) / 100 + ')';
  }

  function hslToRgb(hsl) {
    var h = hsl[0]; var s = hsl[1]; var l = hsl[2];
    if (!s) { var v = Math.round(l * 255); return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    var at = function (t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(at(h + 1 / 3) * 255), Math.round(at(h) * 255), Math.round(at(h - 1 / 3) * 255)];
  }

  /** WCAG relative luminance, which is what a contrast ratio is built from. */
  function luminance(rgb) {
    var c = rgb.map(function (v) {
      var x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** The contrast ratio between two opaque colours, 1 to 21. */
  function contrast(a, b) {
    var la = luminance(a); var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Lay a translucent colour over an opaque one and return what is seen. */
  function composite(rgb, alpha, under) {
    if (alpha >= 1) return rgb;
    if (alpha <= 0) return under;
    return [0, 1, 2].map(function (i) {
      return Math.round(rgb[i] * alpha + under[i] * (1 - alpha));
    });
  }

  /**
   * Where each role sits on a dark page: the band, and how much of the author's
   * own lightness is carried into it.
   *
   * Mirroring the lightness was the first attempt and it fails on the colours
   * that matter. A border at 47% mirrors to 53%, which is still mid-grey against
   * a page at 6%, so the box keeps an outline nobody can see. What decides
   * legibility is the role, not the original value: on a dark page a fill has to
   * be dark and the stroke and label on top of it have to be light, whatever the
   * author started from.
   *
   * The second term keeps a little of the original, so an author who used a
   * paler and a deeper shade of one hue still gets two shades in that order.
   *
   * The third is a ceiling on saturation, and it is what separates a dark theme
   * from a poster. A pastel is a fully saturated hue held at high lightness:
   * #E9D5FF is 100% saturated. Drop it to a fill's lightness at that saturation
   * and it lands on pure violet, six of which read as a set of warning lights.
   * Fills are held to 40%, which is a tinted surface; a border keeps more,
   * because it is a line and has less area to shout with.
   */
  var BANDS = {
    fill: [0.12, 0.12, 0.40],
    stroke: [0.55, 0.24, 0.70],
    color: [0.72, 0.20, 0.55],
  };

  /**
   * One colour, as it should appear on a dark page.
   *
   * Hue and saturation are kept, which is what makes a legend survive: a spec in
   * this store says "a box's fill colour always says which layer its entity
   * belongs to", and the lavender boxes have to stay distinguishable from the
   * blue ones for that sentence to refer to anything.
   *
   * @param {string} value the author's colour
   * @param {'fill'|'stroke'|'color'} [role] what it is being used for
   * @returns {string} a colour, or the input unchanged when it is not one
   */
  function forDark(value, role) {
    var rgb = toRgb(value);
    if (!rgb) return value;
    var hsl = rgbToHsl(rgb);
    var band = BANDS[role] || BANDS.fill;
    var l = band[0] + band[1] * hsl[2];
    // A near-grey has no hue to protect, so it is held down to the page's own
    // range rather than being given a light fill it never asked for.
    var s = Math.min(hsl[1], band[2]);
    if (s < 0.08 && (role || 'fill') === 'fill') l = Math.min(l, 0.24);
    return hslToCss([hsl[0], s, Math.max(0.06, Math.min(0.94, l))], alphaOf(value));
  }

  /**
   * A text colour that reads on the backdrop it is actually drawn on.
   *
   * The colours this repairs are not inline and cannot be found by reading the
   * source: mermaid writes a classDef's `color` into its own stylesheet, and a
   * spec that labels its nodes with HTML styles those labels from the page's
   * stylesheet. Both are invisible to a pass over style attributes, and both
   * were dark values chosen for a light page.
   *
   * Returns null when the text already reads, so a chip the author drew as a
   * light pill with dark writing on it is left as the author drew it.
   *
   * @param {number[]} rgb the colour as rendered
   * @param {number[]} backdrop what it sits on, opaque
   * @param {number} [min] the ratio to hold, 4.5 by default
   */
  function textOn(rgb, backdrop, min) {
    if (contrast(rgb, backdrop) >= (min || 4.5)) return null;
    var hsl = rgbToHsl(rgb);
    var s = Math.min(hsl[1], BANDS.color[2]);
    // Walk away from the backdrop until it reads, rather than jumping to white:
    // the hue is often the only thing marking which group a label belongs to.
    var up = luminance(backdrop) < 0.35;
    for (var i = 0; i < 20; i++) {
      var l = up ? 0.55 + i * 0.02 : 0.42 - i * 0.02;
      var candidate = hslToRgb([hsl[0], s, Math.max(0.04, Math.min(0.97, l))]);
      if (contrast(candidate, backdrop) >= (min || 4.5)) {
        return hslToCss([hsl[0], s, Math.max(0.04, Math.min(0.97, l))]);
      }
    }
    return up ? '#f2f4f8' : '#10141c';
  }

  /** The declarations worth adapting. Anything else in the style is left alone. */
  var COLOUR_PROPS = /^(fill|stroke|color|background-color|stop-color)$/;

  /**
   * Rewrite the colours in an inline style string, keeping everything else.
   *
   * Rebuilt declaration by declaration rather than by replacing hex substrings:
   * a `!important` has to survive, `stroke-width:2px` must not be touched, and a
   * blind substring pass would edit a colour inside a url() reference.
   */
  function adaptStyle(style, dark) {
    return String(style == null ? '' : style).split(';').map(function (part) {
      var at = part.indexOf(':');
      if (at === -1) return part;
      var name = part.slice(0, at).trim().toLowerCase();
      if (!COLOUR_PROPS.test(name)) return part;
      var rest = part.slice(at + 1);
      var bang = rest.match(/!\s*important\s*$/i);
      var value = (bang ? rest.slice(0, bang.index) : rest).trim();
      if (value === 'none' || value === 'transparent' || value === 'inherit') return part;
      // The declaration names the role, which is what decides the band.
      var role = name === 'stroke' ? 'stroke'
        : (name === 'color' ? 'color' : 'fill');
      var next = dark ? forDark(value, role) : value;
      return part.slice(0, at) + ':' + next + (bang ? ' !important' : '');
    }).join(';');
  }

  global.SFMermaidTheme = {
    toRgb: toRgb,
    alphaOf: alphaOf,
    forDark: forDark,
    adaptStyle: adaptStyle,
    contrast: contrast,
    composite: composite,
    textOn: textOn,
  };
}(typeof window === 'undefined' ? globalThis : window));

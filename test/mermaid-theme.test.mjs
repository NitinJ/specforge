// Adapting author-chosen diagram colours to the reader's theme.
//
// The colours in a `style` or `classDef` directive were picked while looking at
// a light page and land as inline styles no stylesheet can outrank. What matters
// on a dark page is that they stop glaring and stay distinguishable from each
// other, because the fill is usually the diagram's legend.
//
// Pure maths, tested without a browser, the same way zoom-view.js is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server/public/mermaid-theme.js', import.meta.url), 'utf8');
const scope = {};
// eslint-disable-next-line no-new-func
new Function('globalThis', 'window', `${src}`).call(scope, scope, scope);
const { toRgb, alphaOf, forDark, adaptStyle, contrast, composite, textOn } = scope.SFMermaidTheme;

/** The lightness of a colour, 0 to 1, for asserting on direction rather than hex. */
function lightness(css) {
  const m = /^hsla?\((\d+),(\d+)%,(\d+)%/.exec(css);
  if (m) return Number(m[3]) / 100;
  const [r, g, b] = toRgb(css);
  return (Math.max(r, g, b) / 255 + Math.min(r, g, b) / 255) / 2;
}
const saturation = (css) => Number(/^hsla?\(\d+,(\d+)%/.exec(css)[1]) / 100;
/** Channels for a colour the module produced, which is an hsl() string. */
function rgbOf(css) {
  const direct = toRgb(css);
  if (direct) return direct;
  const [, h, s, l] = /^hsla?\((\d+),(\d+)%,(\d+)%/.exec(css).map(Number);
  const sat = s / 100; const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return t.map((v) => Math.round((v + m) * 255));
}
const hue = (css) => {
  const m = /^hsla?\((\d+),/.exec(css);
  if (m) return Number(m[1]);
  // The author's own hex, converted the same way the module does, so the
  // before-and-after comparison is like for like rather than a number I typed.
  const [r, g, b] = toRgb(css).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
};

// --- reading a colour ---------------------------------------------------------

test('it reads the forms mermaid actually emits', () => {
  assert.deepEqual(toRgb('#E9D5FF'), [233, 213, 255]);
  assert.deepEqual(toRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(toRgb('rgb(23, 26, 33)'), [23, 26, 33]);
  assert.deepEqual(toRgb('rgba(23,26,33,.5)'), [23, 26, 33]);
});

test('it declines anything that is not a colour', () => {
  // A url() reference and a keyword must come back untouched, or the rewrite
  // corrupts a marker reference into a colour.
  assert.equal(toRgb('url(#arrow)'), null);
  assert.equal(toRgb(''), null);
  assert.equal(toRgb('none'), null);
});

// --- what dark does to it -----------------------------------------------------

test('a pale fill becomes a deep one', () => {
  // The defect: #E9D5FF sat at 92% lightness on a page at 6%.
  const before = lightness('#E9D5FF');
  const after = lightness(forDark('#E9D5FF'));
  assert.ok(before > 0.85, `the fixture is not pale: ${before}`);
  assert.ok(after < 0.25, `still pale on dark: ${after}`);
});

test('a border goes light whatever the author started from', () => {
  // The case that ruled out mirroring the lightness. #7E22CE sits at 47%, so a
  // mirror gives 53%: still mid-grey against a page at 6%, and the box keeps an
  // outline nobody can see. What decides legibility is the role, not the
  // original value.
  for (const stroke of ['#7E22CE', '#0369A1', '#111827', '#B45309']) {
    assert.ok(lightness(forDark(stroke, 'stroke')) > 0.55,
      `${stroke} stayed dark: ${lightness(forDark(stroke, 'stroke'))}`);
  }
});

test('a label goes lighter still, since it sits on the fill', () => {
  assert.ok(lightness(forDark('#111827', 'color')) > lightness(forDark('#111827', 'stroke')));
});

test('the hue survives, which is what makes a legend still read', () => {
  // A spec in this store says "a box's fill colour always says which layer its
  // entity belongs to". Lose the hue and that sentence refers to nothing.
  for (const hex of ['#E9D5FF', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#FDE68A']) {
    const moved = Math.abs(hue(forDark(hex)) - hue(hex));
    assert.ok(Math.min(moved, 360 - moved) <= 2,
      `${hex} moved hue from ${hue(hex)} to ${hue(forDark(hex))}`);
  }
});

test('colours that differed still differ', () => {
  const fills = ['#E9D5FF', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#FDE68A', '#C7D2FE'];
  const after = fills.map((f) => forDark(f));
  assert.equal(new Set(after).size, fills.length, `collapsed: ${after.join(' ')}`);
});

test('two shades of one hue stay in their order', () => {
  // The band carries a little of the author's own lightness for this: an author
  // who used a paler and a deeper blue meant two things by them.
  const pale = lightness(forDark('#BAE6FD'));
  const deep = lightness(forDark('#0369A1'));
  assert.ok(pale > deep, `order lost: pale=${pale} deep=${deep}`);
});

test('every fill lands dark enough for the page behind it', () => {
  // The page is at 6% lightness. A fill above about a third of the way up reads
  // as a light-mode island, which is the whole complaint.
  for (const hex of ['#E9D5FF', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#FDE68A', '#fff', '#E5E7EB']) {
    assert.ok(lightness(forDark(hex)) <= 0.30, `${hex} is still pale: ${lightness(forDark(hex))}`);
  }
});

test('grey is held down rather than tinted', () => {
  // With no hue to protect there is nothing to preserve, and a grey given a
  // light fill competes with the page's own surfaces.
  assert.ok(lightness(forDark('#E5E7EB')) <= 0.25);
});

test('white and black do not overshoot', () => {
  for (const c of ['#fff', '#000']) {
    const l = lightness(forDark(c));
    assert.ok(l >= 0.05 && l <= 0.95, `${c} went to ${l}`);
  }
});

test('a fill is muted, not turned into a warning light', () => {
  // A pastel is a fully saturated hue held high: #E9D5FF is 100% saturated.
  // Dropped to a fill's lightness at that saturation it lands on pure violet,
  // and six of those read as a poster rather than a diagram.
  for (const hex of ['#E9D5FF', '#BAE6FD', '#BBF7D0', '#FBCFE8']) {
    assert.ok(saturation(forDark(hex)) <= 0.40, `${hex} → ${forDark(hex)}`);
  }
  assert.ok(saturation(forDark('#7E22CE', 'stroke')) <= 0.70);
});

test('translucency survives, because a wash is not a solid badge', () => {
  // A chip drawn as a 60% white pill is a wash over the node's fill. Returned
  // opaque it becomes a solid badge the author never drew.
  assert.equal(alphaOf('rgba(255,255,255,.6)'), 0.6);
  assert.equal(alphaOf('#11182744'), 0x44 / 255);
  assert.equal(alphaOf('transparent'), 0);
  assert.equal(alphaOf('#E9D5FF'), 1);
  assert.match(forDark('rgba(255,255,255,.6)'), /^hsla\(/);
  assert.match(forDark('#E9D5FF'), /^hsl\(/);
});

// --- reading what is actually on screen ---------------------------------------

test('contrast is the WCAG ratio', () => {
  assert.equal(Math.round(contrast([255, 255, 255], [0, 0, 0])), 21);
  assert.equal(contrast([17, 24, 39], [17, 24, 39]), 1);
});

test('a translucent layer is composited onto what is under it', () => {
  assert.deepEqual(composite([255, 255, 255], 0.5, [0, 0, 0]), [128, 128, 128]);
  assert.deepEqual(composite([255, 0, 0], 1, [0, 0, 0]), [255, 0, 0]);
  assert.deepEqual(composite([255, 0, 0], 0, [9, 9, 9]), [9, 9, 9]);
});

test('text that already reads is left as the author drew it', () => {
  // The chip: dark writing on a light pill. Internally consistent, and
  // repairing it would break a pairing that was never broken.
  assert.equal(textOn([17, 24, 39], [226, 216, 240]), null);
});

test('text that does not read is lifted until it does', () => {
  // The defect: a node title at #111827 over a fill this pass just made deep.
  const deep = [57, 0, 117];
  const fixed = textOn([17, 24, 39], deep);
  assert.ok(fixed, 'the unreadable title was left alone');
  assert.ok(contrast(rgbOf(fixed), deep) >= 4.5, `${fixed} still does not read`);
});

test('it walks away from the backdrop rather than jumping to white', () => {
  // Lifting every failing label to white would delete the hue, and the hue is
  // often the only thing saying which group the label belongs to.
  const fixed = textOn([126, 34, 206], [30, 12, 48]);
  assert.ok(fixed && !/^#f/.test(fixed), `gave up on the hue: ${fixed}`);
  assert.ok(Math.abs(hue(fixed) - hue('#7E22CE')) <= 2);
});

test('dark text on a light backdrop is darkened, not lightened', () => {
  // A spec can define its own light palette and still hand a label a colour
  // that does not read on it.
  const fixed = textOn([200, 200, 210], [251, 250, 247]);
  assert.ok(fixed, 'a washed-out label on a light page was left alone');
  assert.ok(lightness(fixed) < 0.5, `went the wrong way: ${fixed}`);
});

// --- rewriting the style attribute --------------------------------------------

test('it rewrites the colours and keeps everything else', () => {
  const out = adaptStyle('fill:#E9D5FF !important;stroke:#7E22CE !important;stroke-width:2px', true);
  assert.match(out, /^fill:hsl\([^)]*\) !important;/, out);
  assert.match(out, /stroke:hsl\([^)]*\) !important/, out);
  assert.match(out, /stroke-width:2px$/, 'a non-colour declaration was touched');
});

test('!important survives, because without it the rewrite loses to mermaid', () => {
  assert.ok(adaptStyle('fill:#fff !important', true).includes('!important'));
  assert.ok(!adaptStyle('fill:#fff', true).includes('!important'), 'one was invented');
});

test('light returns the author their own colours', () => {
  const style = 'fill:#E9D5FF !important;stroke:#7E22CE !important';
  assert.equal(adaptStyle(style, false), style);
});

test('none, transparent and inherit are left alone', () => {
  const style = 'fill:none;stroke:transparent;color:inherit';
  assert.equal(adaptStyle(style, true), style);
});

test('a url() reference is not mistaken for a colour', () => {
  // Mermaid points markers at defs this way. Rewriting one detaches the arrowhead.
  const style = 'fill:url(#arrow);stroke:#333';
  const out = adaptStyle(style, true);
  assert.match(out, /fill:url\(#arrow\)/);
  assert.match(out, /stroke:hsl\(/);
});

test('an empty or malformed style does not throw', () => {
  assert.equal(adaptStyle('', true), '');
  assert.equal(adaptStyle(null, true), '');
  assert.equal(adaptStyle('nonsense', true), 'nonsense');
});

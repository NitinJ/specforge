// Unit tests for the injected review-layer client (server/public/review.js),
// executed in a jsdom DOM. These cover the JS lifecycle + the block-level
// comment interaction: chrome builds once, the SpecForge launcher menu
// opens/closes and carries the review controls, hovering a block highlights it,
// clicking a block opens the composer and posts a block anchor. Layout (the
// launcher/popover positioning) needs a real browser and lives in the
// Playwright e2e tier.
//
// The fixture has NO <section> wrappers on purpose — block-level commenting
// must work on any spec, regardless of structure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_JS = readFileSync(join(ROOT, 'server', 'public', 'review.js'), 'utf8');

const SPEC_BODY = `
  <main>
    <h1>Test Spec</h1>
    <h2>Overview</h2>
    <p class="a">The quick brown fox.</p>
    <p class="b">Second paragraph for hover.</p>
    <ul><li class="c">A list item block.</li></ul>
  </main>
  <div id="sf-live">● live</div>
`;

/**
 * Boot the review client the way a deferred <script> does: it runs after the
 * document is parsed (readyState !== 'loading'), THEN DOMContentLoaded fires.
 * Returns { window, posts } where posts captures any POST fetch bodies.
 */
async function bootReviewLayer(t, opts = {}) {
  const body = opts.body || SPEC_BODY;
  const threadsJson = JSON.stringify({ threads: opts.threads || [] });
  const meta = opts.meta || { id: 'test-spec', title: 'Test', status: 'draft', attachedSession: null };
  const html = `<!doctype html><html><head></head><body>${body}</body></html>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  // review.js installs a setInterval poll; close the window after the test so
  // the timer is cleared and the test runner can exit.
  t.after(() => window.close());
  // Seed localStorage BEFORE the client boots (the TOC reads its per-spec
  // collapse state from it at build time).
  if (opts.seedStorage) {
    try { Object.keys(opts.seedStorage).forEach((k) => window.localStorage.setItem(k, opts.seedStorage[k])); } catch (e) {}
  }
  window.SPECFORGE = { specId: 'test-spec', prefs: opts.prefs || {} };
  // jsdom defaults innerWidth to 1024 (below the TOC auto-collapse threshold);
  // let tests widen it so the floating TOC shows in auto mode.
  if (opts.innerWidth) Object.defineProperty(window, 'innerWidth', { value: opts.innerWidth, configurable: true });
  const posts = [];
  const puts = [];
  const patches = [];
  window.fetch = (url, init) => {
    if (init && (init.method === 'POST' || init.method === 'PUT' || init.method === 'PATCH')) {
      const bucket = init.method === 'PUT' ? puts : init.method === 'PATCH' ? patches : posts;
      bucket.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      // opts.failPost lets a test make one endpoint reject, to prove the client
      // checks Response.ok rather than assuming a fulfilled fetch succeeded.
      const ok = !(opts.failPost && opts.failPost.test(String(url)));
      return Promise.resolve({ ok, json: () => Promise.resolve({ ok }), text: () => Promise.resolve('{}') });
    }
    if (String(url).indexOf('/meta') !== -1) {
      return Promise.resolve({ json: () => Promise.resolve(meta) });
    }
    return Promise.resolve({ text: () => Promise.resolve(threadsJson) });
  };
  // Optionally stub the body's computed background so the theme-detection logic
  // (which reads body-background luminance) is deterministic — jsdom has no real
  // CSS engine, so without this getComputedStyle returns no usable color.
  if (opts.computedBg) {
    const origGCS = window.getComputedStyle.bind(window);
    window.getComputedStyle = (el, ps) =>
      (el === window.document.body ? { backgroundColor: opts.computedBg(window) } : origGCS(el, ps));
  }
  await new Promise((r) => window.setTimeout(r, 0));
  // Last hook before the client boots — for stubbing browser APIs jsdom lacks
  // (e.g. ResizeObserver) that the client feature-detects at build time.
  if (opts.preBoot) opts.preBoot(window);
  window.eval(REVIEW_JS); // deferred-script execution → boot() via the readyState check
  window.document.dispatchEvent(new window.Event('DOMContentLoaded')); // the DCL that follows
  await new Promise((r) => window.setTimeout(r, 0)); // flush load()/render microtasks
  return { window, posts, puts, patches };
}

const mouse = (window, el, type) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
// Find a menu row button by its visible label text.
const rowByLabel = (document, label) =>
  Array.prototype.find.call(document.querySelectorAll('#sf-menu .sf-menu-row'), (r) =>
    r.textContent.includes(label));

test('review chrome is built exactly once (defer run + DOMContentLoaded)', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  assert.equal(document.querySelectorAll('#sf-launcher').length, 1, 'exactly one launcher');
  assert.equal(document.querySelectorAll('#sf-menu').length, 1, 'exactly one launcher menu');
  assert.equal(document.querySelectorAll('#sf-sidebar').length, 1, 'exactly one sidebar');
});

test('a back-to-top button is built and scrolls to the top on click', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  assert.equal(document.querySelectorAll('#sf-top').length, 1, 'exactly one Top button');
  let scrolledTo = null;
  window.scrollTo = function (opts) { scrolledTo = opts; };
  document.getElementById('sf-top').click();
  assert.ok(scrolledTo && scrolledTo.top === 0, 'clicking scrolls to the top');
});

test('the Top button hides at the top and shows after scrolling down', async (t) => {
  const { window } = await bootReviewLayer(t);
  const top = window.document.getElementById('sf-top');
  assert.ok(!top.classList.contains('show'), 'hidden at the top of the page');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: function () { return 500; } });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(top.classList.contains('show'), 'shows after scrolling down past the threshold');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: function () { return 0; } });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(!top.classList.contains('show'), 'hides again near the top');
});

test('the launcher menu opens and closes', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const launcher = document.getElementById('sf-launcher');
  const menu = document.getElementById('sf-menu');
  assert.ok(!menu.classList.contains('open'), 'menu starts closed');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
  launcher.click();
  assert.ok(menu.classList.contains('open'), 'launcher opens the menu');
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  launcher.click();
  assert.ok(!menu.classList.contains('open'), 'launcher closes the menu');
  assert.equal(launcher.getAttribute('aria-expanded'), 'false');
});

test('the menu carries the Comments, Width and Theme rows', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  assert.ok(rowByLabel(document, 'Comments'), 'Comments row present');
  const width = rowByLabel(document, 'Width');
  assert.ok(width, 'Width row present');
  assert.ok(width.querySelector('input[type=range]'), 'Width row has a range input');
  assert.ok(rowByLabel(document, 'Theme'), 'Theme row present');
});

test('the menu has an Export PDF row that opens the print dialog', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  let printed = 0;
  window.print = function () { printed++; };
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Export PDF');
  assert.ok(row, 'Export PDF row present');
  row.click();
  assert.equal(printed, 1, 'clicking Export PDF calls window.print()');
});

test('the Comments row toggles the single sidebar', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const sidebar = document.getElementById('sf-sidebar');
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();
  assert.ok(sidebar.classList.contains('open'), 'Comments row opens the sidebar');
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();
  assert.ok(!sidebar.classList.contains('open'), 'Comments row closes the sidebar');
});

test('the Theme picker sets data-theme on <html> from a swatch', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const theme = rowByLabel(document, 'Theme');
  theme.querySelector('.sf-swatch[data-theme="dark"]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'dark swatch → dark');
  theme.querySelector('.sf-swatch[data-theme="light"]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light', 'light swatch → light');
});

test('the Theme picker offers the named variants and applies one', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const theme = rowByLabel(document, 'Theme');
  for (const id of ['light', 'dark', 'dracula', 'nord', 'solarized-dark', 'solarized-light', 'github-light', 'gruvbox-light']) {
    assert.ok(theme.querySelector('.sf-swatch[data-theme="' + id + '"]'), id + ' swatch present');
  }
  theme.querySelector('.sf-swatch[data-theme="dracula"]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dracula', 'a variant applies to <html>');
});

test('Theme picker reflects the rendered theme and switches a multi-theme spec', async (t) => {
  // A spec that honors [data-theme]: the body background flips with the attribute.
  const computedBg = (w) => (w.document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'rgb(15, 17, 21)' : 'rgb(251, 250, 247)');
  const { window } = await bootReviewLayer(t, { computedBg });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const theme = rowByLabel(document, 'Theme');
  assert.ok(theme.querySelector('.sf-themes'), 'a multi-theme spec shows the picker');
  assert.equal(theme.querySelector('.sf-swatch.on').getAttribute('data-theme'), 'light',
    'the active swatch reflects the rendered light theme — not a hardcoded default');
  theme.querySelector('.sf-swatch[data-theme="dark"]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'switches to dark');
});

test('Theme row is fixed (no picker) when the spec defines a single theme', async (t) => {
  // An imported spec that ignores [data-theme]: the body background never changes.
  const { window } = await bootReviewLayer(t, { computedBg: () => 'rgb(244, 239, 230)' });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const theme = rowByLabel(document, 'Theme');
  assert.ok(!theme.querySelector('.sf-themes'), 'a single-theme spec offers no picker');
  assert.match(theme.querySelector('.sf-row-val').textContent, /light · fixed/,
    'shows the actual (light) theme, marked fixed — the selector never lies');
});

test('hovering a block highlights it; moving moves the highlight', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const a = document.querySelector('p.a');
  const b = document.querySelector('p.b');
  mouse(window, a, 'mousemove');
  assert.ok(a.classList.contains('sf-hover'), 'first block highlights on hover');
  mouse(window, b, 'mousemove');
  assert.ok(b.classList.contains('sf-hover'), 'second block highlights');
  assert.ok(!a.classList.contains('sf-hover'), 'first block un-highlights');
});

test('clicking a block (no <section> needed) opens the composer and posts a block anchor', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const { document } = window;
  const li = document.querySelector('li.c');
  mouse(window, li, 'click');
  const compose = document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(compose, 'composer opens for a list-item block');
  const ta = compose.querySelector('textarea');
  ta.value = 'a block comment';
  compose.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(posts.length, 1, 'one comment POSTed');
  assert.equal(posts[0].body.anchor.block.tag, 'LI', 'anchored to the LI block');
  assert.equal(posts[0].body.anchor.block.text, 'A list item block.');
  assert.equal(posts[0].body.body, 'a block comment');
});

test('clicking the review UI does not open a composer', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  assert.equal(document.querySelector('#sf-rail .sf-bub-compose'), null, 'no composer from a UI click');
});

test('the review command bar lives in the sidebar footer, not the launcher menu', async (t) => {
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'human', body: 'x' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window, posts } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const { document } = window;
  const foot = document.querySelector('#sf-sidebar .sf-side-foot');
  assert.ok(foot, 'footer is a child of the sidebar');
  assert.ok(foot.querySelector('.sf-filter'), 'footer carries the view filter');
  const action = foot.querySelector('.sf-act');
  assert.ok(action, 'footer carries the lifecycle action button');
  // A pending comment → the action is "Needs review" and submits the batch.
  assert.equal(action.getAttribute('data-state'), 'needs');
  assert.match(foot.querySelector('.sf-foot-caption').textContent, /to submit/);
  action.click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)), 'footer action submits the batch');
  document.getElementById('sf-launcher').click();
  assert.ok(!rowByLabel(document, 'Submit'), 'the launcher menu has no Submit row');
});

test('opening the sidebar flags the body (floating controls clear it); × closes it', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();
  assert.ok(document.body.classList.contains('sf-side-open'), 'body flagged when the sidebar opens');
  document.querySelector('.sf-side-close').click();
  assert.ok(!document.body.classList.contains('sf-side-open'), 'close button clears the flag');
  assert.ok(!document.getElementById('sf-sidebar').classList.contains('open'), 'sidebar is closed');
});

test('a thread re-anchors to its section when the exact block is gone', async (t) => {
  const body = `<main><section id="s1"><h2>S1</h2><p class="x">current text</p></section></main><div id="sf-live">● live</div>`;
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'human', body: 'c' }],
    anchor: { block: { index: 99, tag: 'P', text: 'a block that no longer exists', sectionPath: ['s1'] } },
  }];
  const { window } = await bootReviewLayer(t, { body, threads });
  assert.equal(window.document.getElementById('s1').getAttribute('data-sf-thread'), 't1',
    'falls back to the enclosing section');
});

test('a thread re-anchors to the parent section when its own section is removed', async (t) => {
  // The original section (#child) is gone; only #parent survives in the spec.
  const body = `<main><section id="parent"><h2>P</h2><p>still here</p></section></main><div id="sf-live">● live</div>`;
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'human', body: 'c' }],
    anchor: { block: { index: 99, tag: 'P', text: 'gone', sectionPath: ['child', 'parent'] } },
  }];
  const { window } = await bootReviewLayer(t, { body, threads });
  assert.equal(window.document.getElementById('parent').getAttribute('data-sf-thread'), 't1',
    'falls back to the parent section when the original section is removed');
});

// ---------- editing an unsubmitted comment ----------
const EDIT_ANCHOR = { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } };

test('an unsubmitted human comment shows an Edit control that PATCHes the new body', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window, patches } = await bootReviewLayer(t, { threads });
  const { document } = window;
  const cEl = document.querySelector('.sf-comment[data-cid="c1"]');
  assert.ok(cEl, 'comment rendered');
  const editBtn = cEl.querySelector('.sf-edit-c');
  assert.ok(editBtn, 'Edit control present on an unsubmitted human comment');

  editBtn.click();
  const ta = cEl.querySelector('.sf-edit textarea');
  assert.ok(ta, 'clicking Edit opens an inline editor');
  assert.equal(ta.value, 'original', 'editor is prefilled with the current body');

  ta.value = 'edited body';
  cEl.querySelector('.sf-edit .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = patches.find((x) => /\/comments\/t1\/comment\/c1$/.test(x.url));
  assert.ok(p, 'Save PATCHes the comment endpoint');
  assert.equal(p.body.body, 'edited body', 'with the new body');
});

test('a submitted (batched) comment has no Edit control', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'x', batchId: 'b1' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const cEl = window.document.querySelector('.sf-comment[data-cid="c1"]');
  assert.ok(cEl, 'comment rendered');
  assert.ok(!cEl.querySelector('.sf-edit-c'), 'no Edit control once the comment is frozen into a batch');
});

test('a claude (agent) comment has no Edit control', async (t) => {
  const threads = [{
    id: 't1', state: 'replied',
    comments: [{ id: 'c1', author: 'human', body: 'x', batchId: 'b1' }, { id: 'c2', author: 'claude', body: 'fixed' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const c2 = window.document.querySelector('.sf-comment[data-cid="c2"]');
  assert.ok(c2, 'claude comment rendered');
  assert.ok(!c2.querySelector('.sf-edit-c'), 'claude comments are not editable');
});

// ---------- floating spec title (appears on scroll) ----------
test('a floating title bar mirrors the spec h1 and is hidden at the top', async (t) => {
  const { window } = await bootReviewLayer(t);
  const bar = window.document.getElementById('sf-titlebar');
  assert.ok(bar, 'the floating title bar is built');
  assert.equal(bar.tagName, 'BUTTON', 'it is a native button (focusable, keyboard-activatable)');
  assert.equal(bar.querySelector('.sf-tb-title').textContent, 'Test Spec', 'it shows the spec h1');
  assert.ok(!bar.classList.contains('show'), 'hidden while the real title is still in view');
});

test('the floating title appears after scrolling past the title and hides back at the top', async (t) => {
  const { window } = await bootReviewLayer(t);
  const bar = window.document.getElementById('sf-titlebar');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 500 });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(bar.classList.contains('show'), 'shows once scrolled down past the title');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(!bar.classList.contains('show'), 'hides again at the top');
});

test('clicking the floating title scrolls back to the top', async (t) => {
  const { window } = await bootReviewLayer(t);
  let scrolledTo = null;
  window.scrollTo = (o) => { scrolledTo = o; };
  window.document.getElementById('sf-titlebar').click();
  assert.ok(scrolledTo && scrolledTo.top === 0, 'clicking scrolls to top');
});

test('the floating title falls back to the stored spec title when there is no h1', async (t) => {
  const body = `<main><p>No heading here.</p></main><div id="sf-live">● live</div>`;
  const meta = { id: 'test-spec', title: 'Stored Title', status: 'draft', attachedSession: null };
  const { window } = await bootReviewLayer(t, { body, meta });
  const bar = window.document.getElementById('sf-titlebar');
  assert.equal(bar.querySelector('.sf-tb-title').textContent, 'Stored Title', 'uses meta.title when no h1');
});

// ---------- comment body formatting (safe markdown subset) ----------
// A comment renders its body through fmtBody: paragraphs, - / * / 1. lists,
// **bold**, *italic*, `code` — everything HTML-escaped first so no markup in a
// body can reach the DOM. The raw source is kept for editing (see the edit test).
const FMT_ANCHOR = { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } };
const bodyHtmlOf = async (t, body) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body }], anchor: FMT_ANCHOR }];
  const { window } = await bootReviewLayer(t, { threads });
  return window.document.querySelector('.sf-comment[data-cid="c1"] .body').innerHTML;
};

test('a comment body renders bold, italic and inline code', async (t) => {
  const html = await bodyHtmlOf(t, 'Use **bold**, some *italic* and `code()` here.');
  assert.match(html, /<strong>bold<\/strong>/, 'bold');
  assert.match(html, /<em>italic<\/em>/, 'italic');
  assert.match(html, /<code>code\(\)<\/code>/, 'inline code');
});

test('a comment body renders a bullet list', async (t) => {
  const html = await bodyHtmlOf(t, '- first\n- second\n- third');
  assert.match(html, /<ul><li>first<\/li><li>second<\/li><li>third<\/li><\/ul>/, 'bullets become a <ul>');
});

test('a comment body renders a numbered list', async (t) => {
  const html = await bodyHtmlOf(t, '1. one\n2. two');
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/, 'numbers become an <ol>');
});

test('a comment body splits paragraphs on blank lines and keeps a list after prose', async (t) => {
  const html = await bodyHtmlOf(t, 'Intro line.\n\nThen a point:\n- a\n- b');
  assert.match(html, /<p>Intro line\.<\/p>/, 'first paragraph');
  assert.match(html, /<p>Then a point:<\/p><ul><li>a<\/li><li>b<\/li><\/ul>/, 'prose flushes before the list');
});

test('a comment body escapes HTML before formatting (no injection)', async (t) => {
  const html = await bodyHtmlOf(t, 'watch **<img src=x onerror=alert(1)>** out');
  assert.doesNotMatch(html, /<img/, 'the tag is escaped, not injected');
  assert.match(html, /&lt;img/, 'shown as escaped text');
  assert.match(html, /<strong>&lt;img[^<]*&gt;<\/strong>/, 'emphasis still wraps the escaped text');
});

test('a plain one-line comment renders as a single paragraph', async (t) => {
  const html = await bodyHtmlOf(t, 'Just fix the typo.');
  assert.equal(html, '<p>Just fix the typo.</p>');
});

test('an unmatched backtick renders literally, not as an empty code span', async (t) => {
  const html = await bodyHtmlOf(t, 'the `count var is off');
  assert.doesNotMatch(html, /<code>/, 'no code span without a closing backtick');
  assert.match(html, /`count var is off/, 'the stray backtick and its text survive');
});

// ---------- comments rail (floating bubbles) ----------
// jsdom has no layout engine: every rect is zero and offsetHeight is always 0.
// These tests therefore stub the geometry the rail measures — a top per block
// selector, and one uniform bubble height — then assert the positions the
// layout pass computes from it.
function stubGeometry(window, tops, bubbleH = 40) {
  const { document } = window;
  Object.keys(tops).forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`stubGeometry: no element for ${sel}`);
    el.getBoundingClientRect = () => ({
      top: tops[sel], bottom: tops[sel] + 20, left: 0, right: 100, width: 100, height: 20,
    });
  });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get() { return bubbleH; },
  });
}
const railTops = (window) =>
  [...window.document.querySelectorAll('#sf-rail .sf-bub')].map((b) => parseFloat(b.style.top));
// The rail repositions on a rAF tick; jsdom's rAF is async, so nudge and flush.
async function settleRail(window) {
  window.dispatchEvent(new window.Event('resize'));
  await new Promise((r) => window.setTimeout(r, 20));
}

test('the rail renders one collapsed bubble per open thread, ordered by anchor position', async (t) => {
  const threads = [
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'second' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'first' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  stubGeometry(window, { 'p.a': 100, 'p.b': 300 });
  await settleRail(window);
  const bubs = window.document.querySelectorAll('#sf-rail .sf-bub');
  assert.equal(bubs.length, 2, 'one bubble per open thread');
  assert.equal(bubs[0].getAttribute('data-tid'), 't1', 'ordered by anchor position, not array order');
  assert.equal(bubs[1].getAttribute('data-tid'), 't2');
});

test('a bubble sits at its anchor when there is room', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  stubGeometry(window, { 'p.a': 250 });
  await settleRail(window);
  assert.deepEqual(railTops(window), [250], 'pinned to its anchor top');
});

test('colliding bubbles are pushed down and never overlap', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'b' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  stubGeometry(window, { 'p.a': 100, 'p.b': 110 }, 40); // anchors 10px apart, bubbles 40px tall
  await settleRail(window);
  const tops = railTops(window);
  assert.equal(tops[0], 100, 'the first keeps its anchor');
  assert.ok(tops[1] >= tops[0] + 40, `second pushed clear of the first (got ${tops[1]})`);
});

test('two threads on the SAME block both get bubbles, stacked', async (t) => {
  const anchor = { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } };
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }], anchor },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }], anchor },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  stubGeometry(window, { 'p.a': 200 }, 40);
  await settleRail(window);
  const tops = railTops(window);
  assert.equal(tops.length, 2, 'both threads on one block get their own bubble');
  assert.equal(tops[0], 200, 'the first takes the anchor line');
  assert.ok(tops[1] >= 240, 'the second stacks below it');
});

test('a resolved thread gets no bubble', async (t) => {
  const threads = [{ id: 't1', state: 'resolved', comments: [{ id: 'c1', author: 'human', body: 'x', batchId: 'b1' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  assert.equal(window.document.querySelectorAll('#sf-rail .sf-bub').length, 0);
});

test('a bubble shows the author initial and reply count', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'the question' }, { id: 'c2', author: 'claude', body: 'the answer' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const bub = window.document.querySelector('#sf-rail .sf-bub');
  assert.equal(bub.querySelector('.sf-bub-who').textContent, 'H', 'initial of the thread starter');
  assert.match(bub.querySelector('.sf-bub-snip').textContent, /the question/, 'snippet of the first comment');
  assert.equal(bub.querySelector('.sf-bub-n').textContent, '1', 'one reply');
});

test('clicking a bubble activates its thread and shows the conversation in place', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('#sf-rail .sf-bub').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(document.querySelector('#sf-rail .sf-bub-open'), 'the thread expands in the rail');
  assert.ok(document.querySelector('.sf-block-mark').classList.contains('sf-active'),
    'its block reads as active — the bubble is bound to the block it annotates');
});

test('the rail re-positions on reflows that fire no scroll or resize event', async (t) => {
  // Width changes, fit-to-width, a collapsing TOC and late web fonts all move
  // anchors without a scroll/resize — the rail observes the content box instead.
  const observed = [];
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  await bootReviewLayer(t, {
    threads,
    preBoot(w) {
      w.ResizeObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) { observed.push(el); }
        disconnect() {}
      };
    },
  });
  assert.ok(observed.length >= 1, 'the rail observes the content box for reflow');
});

test('the rail is a native-button surface the review layer treats as its own UI', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  const bub = window.document.querySelector('#sf-rail .sf-bub');
  assert.equal(bub.tagName, 'BUTTON', 'bubbles are focusable buttons');
  // Clicking rail chrome must not be mistaken for clicking a spec block.
  mouse(window, bub, 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!window.document.getElementById('sf-compose'), 'no composer opens from a rail click');
});

// ---------- expanding a thread in the rail ----------
const RAIL_ANCHOR = { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } };
const twoOnOneBlock = () => [
  { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }], anchor: RAIL_ANCHOR },
  { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }], anchor: RAIL_ANCHOR },
];

test('clicking a bubble expands that thread in place, and only that one', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const open = document.querySelectorAll('#sf-rail .sf-bub-open');
  assert.equal(open.length, 1, 'exactly one thread is expanded');
  assert.equal(open[0].getAttribute('data-tid'), 't1');
  assert.ok(open[0].querySelector('textarea'), 'the expanded card carries a reply box');
  document.querySelector('.sf-bub[data-tid="t2"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const open2 = document.querySelectorAll('#sf-rail .sf-bub-open');
  assert.equal(open2.length, 1, 'opening another collapses the first');
  assert.equal(open2[0].getAttribute('data-tid'), 't2');
});

test('the expanded thread pins to its anchor exactly and pushes its sibling down', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  stubGeometry(window, { 'p.a': 220 }, 40);
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t2"]').click();      // focus the SECOND
  await new Promise((r) => window.setTimeout(r, 20));
  const open = document.querySelector('.sf-bub[data-tid="t2"]');
  const sib = document.querySelector('.sf-bub[data-tid="t1"]');
  assert.equal(parseFloat(open.style.top), 220, 'focused thread sits exactly on its anchor');
  assert.ok(parseFloat(sib.style.top) > parseFloat(open.style.top),
    'its same-block sibling is pushed below it, not the other way round');
});

test('the expanded thread accent-binds its block', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(document.querySelector('.sf-block-mark').classList.contains('sf-active'),
    'the anchored block reads as the active pair');
});

test('clicking outside collapses the expanded thread, and so does Escape', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 1);
  document.body.click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 0, 'a click outside collapses it');

  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 0, 'Escape collapses it too');
});

test('clicking inside the expanded card does not collapse it', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  document.querySelector('.sf-bub-open textarea').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 1, 'still open while you use it');
});

test('replying from the expanded card posts to the thread', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const card = document.querySelector('.sf-bub-open');
  card.querySelector('textarea').value = 'a reply from the rail';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments\/t1\/reply$/.test(x.url));
  assert.ok(p, 'posts to the reply endpoint');
  assert.equal(p.body.body, 'a reply from the rail');
});

test('resolving from the expanded card posts resolve', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  document.querySelector('.sf-bub-open .sf-bub-resolve').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(posts.find((x) => /\/comments\/t1\/resolve$/.test(x.url)), 'posts to the resolve endpoint');
});

test('a failed resolve leaves the thread expanded instead of pretending it worked', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock(), failPost: /\/resolve$/ });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  document.querySelector('.sf-bub-open .sf-bub-resolve').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 1,
    'the card stays open — fetch fulfills on 4xx, so an unchecked .then() would have collapsed it');
});

test('moving the pointer inside a hovered bubble keeps its block highlighted', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  const block = document.querySelector('p.a');
  const bub = document.querySelector('.sf-bub[data-tid="t1"]');
  bub.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  assert.ok(block.classList.contains('sf-hover'), 'hovering the bubble highlights its block');
  // A mousemove landing on the bubble must not clear what the bubble just set.
  mouse(window, bub, 'mousemove');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(block.classList.contains('sf-hover'), 'still highlighted — no flicker while the bubble is hovered');
});

test('entering a bubble clears the highlight left on a different block', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  const a = document.querySelector('p.a'), b = document.querySelector('p.b');
  mouse(window, a, 'mousemove');                       // hover block A
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(a.classList.contains('sf-hover'), 'block A highlighted');
  // Pointer goes straight from block A into the bubble for block B.
  document.querySelector('.sf-bub[data-tid="t2"]').dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  assert.ok(b.classList.contains('sf-hover'), 'block B highlighted');
  assert.ok(!a.classList.contains('sf-hover'), 'block A released — only one block is ever the hovered pair');
});

test('hovering a block focuses every bubble anchored to it, and vice-versa', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  const block = document.querySelector('p.a');
  mouse(window, block, 'mousemove');
  await new Promise((r) => window.setTimeout(r, 0));
  const focused = document.querySelectorAll('#sf-rail .sf-bub.sf-bub-focus');
  assert.equal(focused.length, 2, 'both threads on the hovered block light up');

  const bub = document.querySelector('.sf-bub[data-tid="t1"]');
  bub.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  assert.ok(block.classList.contains('sf-hover'), 'hovering a bubble lights up its block');
});

// ---------- composing a new thread in the rail ----------
test('clicking a block opens a compose card in the rail, pinned to that block', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  const card = document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'the composer opens in the rail, not as a detached popover');
  assert.ok(card.querySelector('textarea'), 'with an input ready');
  assert.ok(!document.getElementById('sf-compose'), 'the old floating popover is gone');
  assert.ok(document.querySelector('p.a').classList.contains('sf-active'),
    'the target block is accent-bound while composing');
});

test('submitting the rail composer creates a new thread on that block', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  const card = document.querySelector('#sf-rail .sf-bub-compose');
  card.querySelector('textarea').value = 'a brand new thread';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.ok(p, 'posts to the create-thread endpoint');
  assert.equal(p.body.body, 'a brand new thread');
  assert.equal(p.body.anchor.block.text, 'The quick brown fox.', 'anchored to the clicked block');
});

test('a block that already has threads still composes a NEW one, stacked with them', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  stubGeometry(window, { 'p.a': 200 }, 40);
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(document.querySelector('#sf-rail .sf-bub-compose'), 'a composer opens even though the block has threads');
  assert.equal(document.querySelectorAll('#sf-rail .sf-bub').length, 3,
    'the composer joins the two existing bubbles in the rail');
  const compose = document.querySelector('.sf-bub-compose');
  assert.equal(parseFloat(compose.style.top), 200, 'the composer takes the anchor line — it is the focused card');
});

test('cancelling the composer creates nothing and clears it', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  document.querySelector('.sf-bub-compose .sf-bub-x').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!document.querySelector('.sf-bub-compose'), 'the composer is gone');
  assert.equal(posts.filter((x) => /\/comments$/.test(x.url)).length, 0, 'nothing was created');
});

test('Escape dismisses the composer without creating a thread', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!document.querySelector('.sf-bub-compose'), 'dismissed');
  assert.equal(posts.filter((x) => /\/comments$/.test(x.url)).length, 0, 'nothing was created');
});

test('clicking a second block moves the composer there', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  mouse(window, document.querySelector('p.b'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  const cards = document.querySelectorAll('.sf-bub-compose');
  assert.equal(cards.length, 1, 'only ever one composer');
  assert.equal(cards[0]._anchor, document.querySelector('p.b'), 'it moved to the newly clicked block');
});

// ---------- off-screen comment indicator ----------
test('a chip counts open threads anchored above and below the viewport', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'above' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'below' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': -500, 'p.b': 4000 }, 40); // one above, one below
  await settleRail(window);
  const above = window.document.querySelector('#sf-rail .sf-rail-above');
  const below = window.document.querySelector('#sf-rail .sf-rail-below');
  assert.ok(above && /1/.test(above.textContent), 'counts the one scrolled off the top');
  assert.ok(below && /1/.test(below.textContent), 'counts the one below the fold');
});

test('the off-screen chips disappear when every thread is in view', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': 300 }, 40);
  await settleRail(window);
  assert.ok(!window.document.querySelector('#sf-rail .sf-rail-above'), 'no above chip');
  assert.ok(!window.document.querySelector('#sf-rail .sf-rail-below'), 'no below chip');
});

// ---------- multiple threads per block ----------
// A block is no longer limited to one thread: clicking an already-commented
// block starts a NEW thread rather than replying to the existing one. Existing
// threads are read and replied to from the rail (and the drawer).
test('clicking an already-commented block opens a NEW-thread composer', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'first', batchId: 'b1' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window, posts } = await bootReviewLayer(t, { threads });
  const { document } = window;
  const block = document.querySelector('[data-sf-thread="t1"]');
  assert.ok(block, 'the commented block is highlighted with its thread id');

  mouse(window, block, 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  const box = document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(box, 'a composer opens (not a reply box on the existing thread)');

  const ta = box.querySelector('textarea');
  ta.value = 'a second, separate thread';
  box.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.ok(p, 'posts to the create-thread endpoint');
  assert.equal(p.body.body, 'a second, separate thread');
  assert.equal(p.body.anchor.block.text, 'The quick brown fox.', 'anchored to the same block');
});

test('a block carrying two threads records both ids', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }], anchor: EDIT_ANCHOR },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }], anchor: EDIT_ANCHOR },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  const block = window.document.querySelector('.sf-block-mark');
  assert.ok(block, 'the shared block is marked once');
  assert.equal(block.getAttribute('data-sf-threads'), 't1,t2', 'both threads recorded on the block');
  assert.equal(block.getAttribute('data-sf-thread'), 't1', 'the first stays addressable for scroll-to');
  assert.equal(window.document.querySelectorAll('.sf-block-mark').length, 1, 'no duplicate marks');
});

test('activating a LATER thread on a shared block still scrolls its block into view', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }], anchor: EDIT_ANCHOR },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }], anchor: EDIT_ANCHOR },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  const block = window.document.querySelector('.sf-block-mark');
  let scrolled = 0;
  block.scrollIntoView = () => { scrolled++; };
  window.document.querySelector('.sf-thread[data-tid="t2"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(scrolled, 1, 'the second thread on the block scrolls its anchor into view');
});

test('the active state follows whichever thread on a shared block is active', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'one' }], anchor: EDIT_ANCHOR },
    { id: 't2', state: 'open', comments: [{ id: 'c2', author: 'human', body: 'two' }], anchor: EDIT_ANCHOR },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('.sf-thread[data-tid="t2"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(document.querySelector('.sf-block-mark').classList.contains('sf-active'),
    'the shared block reads as active when its second thread is active');
});

// ---------- lifecycle action button ----------
const PENDING_THREAD = [{
  id: 't1', state: 'open', comments: [{ author: 'human', body: 'x' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
}];
const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

// Resolved thread fixture — "all comments resolved" with no open threads.
const RESOLVED_THREAD = [{
  id: 't1', state: 'resolved', comments: [{ author: 'human', body: 'x', batchId: 'b1' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
}];

// Submitted-but-open fixture — the comment carries a batchId (already submitted)
// yet the thread is still unresolved (the agent hasn't replied/resolved it).
const SUBMITTED_OPEN_THREAD = [{
  id: 't1', state: 'open', comments: [{ author: 'human', body: 'x', batchId: 'b1' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
}];

// Replied fixture — the agent answered (a claude comment flips the thread to
// "replied"), but the human hasn't resolved it yet.
const REPLIED_THREAD = [{
  id: 't1', state: 'replied',
  comments: [{ author: 'human', body: 'x', batchId: 'b1' }, { author: 'claude', body: 'fixed in §4' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
}];

test('action button: an unsubmitted comment → "Submit comments" and submits the batch', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.ok(btn, 'action button present');
  assert.equal(btn.getAttribute('data-state'), 'needs');
  assert.match(btn.textContent, /Submit comments/);
  assert.ok(!btn.querySelector('.sf-spin'), 'an actionable state shows no loading spinner');
  btn.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)), 'clicking submits the batch');
});

test('action button: all comments resolved, not yet approved → "LGTM" and approves', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'lgtm');
  btn.click();
  await tick(window);
  const p = posts.find((x) => /\/status$/.test(x.url));
  assert.ok(p && p.body.status === 'approved', 'clicking LGTM POSTs status=approved');
});

test('action button: all resolved AND approved → "Implement →" and sets implementing', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'approved' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'impl');
  assert.match(btn.textContent, /Implement/);
  btn.click();
  await tick(window);
  const p = posts.find((x) => /\/status$/.test(x.url));
  assert.ok(p && p.body.status === 'implementing', 'clicking Implement POSTs status=implementing');
});

test('action button: an unsubmitted comment overrides approved status → "Submit comments"', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'approved' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'needs', 'open comment takes priority over approved');
  assert.match(btn.textContent, /Submit comments/);
});

test('action button: submitted but unresolved → "Awaiting response" (disabled, nothing to submit)', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting');
  assert.match(btn.textContent, /Awaiting/);
  assert.ok(btn.disabled, 'no submit action once the batch is already submitted');
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows while the agent is working');
});

test('action button: picked-up batch → "Picked up comments" (disabled)', async (t) => {
  const meta = { status: 'in_review', attachedSession: null, reviewProgress: 'picked_up' };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'picked');
  assert.match(btn.textContent, /Picked up comments/);
  assert.ok(btn.disabled, 'no action while the agent has it');
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows once the agent picks the batch up');
});

test('action button: working batch → "Working on comments" (disabled)', async (t) => {
  const meta = { status: 'in_review', attachedSession: null, reviewProgress: 'working' };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'reviewing');
  assert.match(btn.textContent, /Working on comments/);
  assert.ok(btn.disabled);
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows while the agent works the comments');
});

test('action button: a replied thread beats reviewProgress → "Review replies"', async (t) => {
  const meta = { status: 'in_review', attachedSession: null, reviewProgress: 'working' };
  const { window } = await bootReviewLayer(t, { threads: REPLIED_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'replied', 'reply state wins once every open thread is answered');
});

test('action button: a submitted-but-open comment still blocks Implement on an approved doc', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'approved' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting', 'an unresolved comment overrides approved → not Implement');
});

test('action button: a reopened thread with a fresh human comment → "Submit comments"', async (t) => {
  // A previously-submitted thread (old comments carry batchId) the human reopened
  // by adding a new, un-submitted comment — the CTA must light up again.
  const threads = [{
    id: 't1', state: 'open',
    comments: [
      { author: 'human', body: 'original', batchId: 'b1' },
      { author: 'claude', body: 'addressed' },
      { author: 'human', body: 'actually, reconsider' },
    ],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'in_review' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'needs');
  assert.match(btn.textContent, /Submit comments/);
});

test('action button: agent replied to every open thread → "Review replies", clicking opens the sidebar', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: REPLIED_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'replied', 'replied thread is no longer "awaiting"');
  assert.match(btn.textContent, /Review replies/);
  assert.equal(btn.disabled, false, 'Review replies is actionable');
  btn.click();
  assert.ok(window.document.getElementById('sf-sidebar').classList.contains('open'), 'clicking opens the sidebar to read replies');
});

test('action button: one unanswered thread keeps "Awaiting response" even when another was replied', async (t) => {
  const threads = [
    REPLIED_THREAD[0],
    { id: 't2', state: 'open', comments: [{ author: 'human', body: 'y', batchId: 'b1' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'in_review' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting', 'still waiting while any open thread is unanswered');
});

test('action button: an unknown status is an inert display (no silent approve)', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'cancelled' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'other');
  assert.ok(btn.disabled, 'an unrecognized status carries no action');
});

test('action button: implementing is a disabled status display', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'implementing' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'working');
  assert.ok(btn.disabled, 'no action while implementing');
});

test('there is no floating action pill — the lifecycle CTA lives only in the sidebar footer', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  const { document } = window;
  assert.equal(document.getElementById('sf-action'), null, 'the floating #sf-action pill is gone');
  assert.ok(document.querySelector('#sf-sidebar .sf-side-foot .sf-act'), 'the CTA is in the sidebar command bar');
});

test('resolve-all shows when threads are open and posts resolve-all', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD });
  const btn = window.document.querySelector('.sf-resolve-all');
  assert.ok(btn.classList.contains('show'), 'shown with an open thread');
  btn.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/resolve-all$/.test(p.url)), 'posts resolve-all');
});

// ---------- launcher unresolved-comment pill ----------
test('the SF launcher shows a pill with the unresolved-thread count', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ author: 'human', body: 'a' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
    { id: 't2', state: 'open', comments: [{ author: 'human', body: 'b' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  const launcher = window.document.getElementById('sf-launcher');
  assert.ok(launcher.classList.contains('has-count'), 'launcher flagged when threads are unresolved');
  assert.equal(launcher.querySelector('.sf-l-n').textContent, '2', 'pill shows the unresolved count');
});

test('the launcher pill counts unresolved comments, not just un-submitted ones', async (t) => {
  // Submitted (batchId) but still open → pending=0, unresolved=1. The old pending
  // badge hid here; the unresolved pill must stay visible at 1.
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD });
  const launcher = window.document.getElementById('sf-launcher');
  assert.ok(launcher.classList.contains('has-count'), 'still flagged after submit while a thread is open');
  assert.equal(launcher.querySelector('.sf-l-n').textContent, '1');
});

test('the launcher pill clears when every thread is resolved', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: RESOLVED_THREAD });
  const launcher = window.document.getElementById('sf-launcher');
  assert.ok(!launcher.classList.contains('has-count'), 'no pill when nothing is unresolved');
  assert.equal(launcher.querySelector('.sf-l-n').textContent, '', 'pill is empty');
});

test('the menu Comments row badge mirrors the unresolved count', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const badge = rowByLabel(document, 'Comments').querySelector('.sf-menu-badge');
  assert.ok(badge, 'Comments row carries a count badge');
  assert.equal(badge.textContent, '1', 'badge shows the unresolved count');
});

// ---------- Export to Google Docs (dropdown row) ----------
test('the menu has an Export to Google Docs row that POSTs /export', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-1', connected: true } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Export to Google Docs');
  assert.ok(row, 'Export to Google Docs row present');
  row.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/export$/.test(p.url)), 'clicking POSTs /export');
});

test('while exporting, the row shows a spinner and is inert', async (t) => {
  const meta = { status: 'draft', attachedSession: 'sess-1', export: { state: 'working' } };
  const { window, posts } = await bootReviewLayer(t, { meta });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Exporting');
  assert.ok(row, 'shows an Exporting… row while in progress');
  assert.ok(row.querySelector('.sf-spin'), 'with the SpecForge spinner');
  assert.ok(row.disabled, 'inert while the agent works');
  row.click();
  await tick(window);
  assert.ok(!posts.some((p) => /\/export$/.test(p.url)), 'no re-POST while in flight');
});

test('once done, the row opens the Google Doc and offers re-export', async (t) => {
  const url = 'https://docs.google.com/document/d/abc/edit';
  const meta = { status: 'draft', attachedSession: 'sess-1', export: { state: 'done', url } };
  const { window, posts } = await bootReviewLayer(t, { meta });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Open Google Doc');
  assert.ok(row, 'shows an Open Google Doc row when done');
  const link = row.querySelector('a.sf-doc-link');
  assert.equal(link.getAttribute('href'), url, 'a native anchor to the Doc (keyboard-activatable)');
  assert.equal(link.getAttribute('target'), '_blank', 'opens in a new tab');
  row.querySelector('.sf-reexport').click();
  await tick(window);
  assert.ok(posts.some((p) => /\/export$/.test(p.url)), 're-export POSTs /export again');
});

// ---------- launcher footer (live pill · session id · detach) ----------
test('the footer shows the attached session id + Detach (posts /detach), alongside the live pill', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-12345678' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const foot = document.querySelector('#sf-menu .sf-menu-foot');
  assert.ok(foot, 'a single bottom footer row');
  assert.ok(foot.querySelector('#sf-live'), 'the live pill sits in the footer');
  const session = foot.querySelector('.sf-foot-session');
  assert.match(session.textContent, /Session sess-123/, 'the session id is shown centered');
  const detach = foot.querySelector('.sf-detach');
  assert.ok(detach, 'Detach present when attached');
  detach.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/detach$/.test(p.url)), 'Detach posts /detach');
});

// ---------- per-spec UI prefs (theme · width · filter) ----------
test('injected prefs initialize theme, width and filter on boot', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { theme: 'dark', width: 1400, filter: 'all' } });
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'theme applied from prefs');
  document.getElementById('sf-launcher').click();
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  assert.equal(range.value, '1400', 'width initialized from prefs');
  const allBtn = document.querySelector('.sf-filter button[data-f="all"]');
  assert.ok(allBtn.classList.contains('on'), 'persisted filter reflected as the active segment');
});

test('a saved width is applied to the document on boot — without opening the menu', async (t) => {
  // The bug: width only took effect when the width row was built (first menu open),
  // so every spec auto-reload reset the page to its default width until you clicked
  // the SpecForge icon. The saved width must apply on load, no interaction.
  const { window } = await bootReviewLayer(t, { prefs: { width: 1400 } });
  const { document } = window;
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '1400px',
    'the --maxw variable is set on boot from the saved pref');
  assert.equal(document.querySelector('main').style.maxWidth, '1400px',
    'the width container is constrained on boot, before any menu interaction');
});

test('with no saved width, boot imposes no max-width', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '',
    'no width is forced when nothing is persisted (the spec keeps its natural layout)');
});

// ---------- fit-to-width ----------
test('the Width row has a Fit toggle that stretches the page and persists', async (t) => {
  const { window, puts } = await bootReviewLayer(t, { prefs: { width: 1400 } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const fit = rowByLabel(document, 'Width').querySelector('.sf-fit');
  assert.ok(fit, 'Fit toggle present in the Width row');
  fit.click();
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), '', 'fit attr set on <html>');
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '100%', '--maxw stretched');
  assert.equal(document.querySelector('main').style.maxWidth, 'none', 'container cap removed');
  assert.ok(puts.some((p) => /\/prefs$/.test(p.url) && p.body.fit === true), 'PUT persists fit:true');
  fit.click(); // toggle off → back to the slider width
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), null, 'fit attr removed');
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '1400px', 'slider width restored');
  assert.ok(puts.some((p) => /\/prefs$/.test(p.url) && p.body.fit === false), 'PUT persists fit:false');
});

test('a saved fit pref is applied on boot; dragging the slider turns fit off', async (t) => {
  const { window, puts } = await bootReviewLayer(t, { prefs: { fit: true, width: 1400 } });
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), '', 'fit applied on boot');
  document.getElementById('sf-launcher').click();
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1200';
  range.dispatchEvent(new window.Event('input'));
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), null, 'slider use exits fit mode');
  range.dispatchEvent(new window.Event('change'));
  assert.ok(puts.some((p) => /\/prefs$/.test(p.url) && p.body.fit === false), 'exit is persisted');
});

test('a bare slider change (no input event) still exits and persists out of fit mode', async (t) => {
  // `change` can fire without a preceding `input` — the release must
  // unconditionally mean px mode or a stale fit:true wins the next boot.
  const { window, puts } = await bootReviewLayer(t, { prefs: { fit: true, width: 1400 } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1000';
  range.dispatchEvent(new window.Event('change'));
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), null, 'fit exited on change');
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '1000px', 'px width applied');
  const p = puts.find((x) => /\/prefs$/.test(x.url) && x.body.width === 1000);
  assert.ok(p && p.body.fit === false, 'the release persists {width, fit:false}');
});

// ---------- docs layout: floating "Contents" TOC + centered content ----------
// A spec whose own left TOC links to real sections (like every house spec).
const TOC_BODY = `
  <div class="layout">
    <nav class="toc"><a href="#s-intro">Intro</a><a href="#s-design">Design</a><a href="#s-plan">Plan</a></nav>
    <main>
      <section id="s-intro"><h2>Intro</h2><p>The quick brown fox.</p></section>
      <section id="s-design"><h2>Design</h2><p>Body.</p></section>
      <section id="s-plan"><h2>Plan</h2><p>Body.</p></section>
    </main>
  </div>
  <div id="sf-live">● live</div>
`;
// A spec with NO native TOC but enough sections to auto-build one.
const SECTIONS_BODY = `
  <main>
    <section id="a"><h2>Alpha</h2><p>x</p></section>
    <section id="b"><h2>Beta</h2><p>x</p></section>
    <section id="c"><h2>Gamma</h2><p>x</p></section>
  </main>
  <div id="sf-live">● live</div>
`;

test('every spec with sections gets the floating Contents TOC + docs (centered) mode', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  assert.ok(document.getElementById('sf-toc'), 'floating #sf-toc built from the sections');
  assert.equal(document.documentElement.getAttribute('data-sf-docs'), '', 'docs mode set on <html>');
  const links = document.querySelectorAll('#sf-toc a');
  assert.equal(links.length, 3, 'one TOC link per section');
  assert.equal(links[0].getAttribute('href'), '#a', 'links target the section ids');
  assert.ok(document.getElementById('sf-tocbtn'), 'the collapse chevron is built');
});

test("a spec's own left TOC is replaced by the floating one (curated links reused)", async (t) => {
  const { window } = await bootReviewLayer(t, { body: TOC_BODY, innerWidth: 1500 });
  const { document } = window;
  assert.ok(document.getElementById('sf-toc'), '#sf-toc built');
  const labels = [].map.call(document.querySelectorAll('#sf-toc a'), (a) => a.textContent);
  assert.deepEqual(labels, ['Intro', 'Design', 'Plan'], 'reuses the native TOC labels');
  // the native TOC stays in the DOM (review.css hides it), so nothing else breaks
  assert.ok(document.querySelector('nav.toc'), 'native nav.toc left in place (hidden by CSS)');
});

test('the chevron collapses/expands the TOC and persists the choice', async (t) => {
  const { window, puts } = await bootReviewLayer(t, { body: SECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  const btn = document.getElementById('sf-tocbtn');
  assert.equal(document.documentElement.getAttribute('data-sf-toc'), null, 'shown by default on a wide window');
  assert.equal(btn.textContent, '‹', 'collapse chevron while shown');
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-sf-toc'), 'hidden', 'collapsed');
  assert.equal(btn.textContent, '›', 'chevron flips to expand');
  assert.ok(puts.some((p) => /\/api\/spec\/test-spec\/prefs$/.test(p.url) && p.body.toc === 'hidden'), 'persists toc:hidden per-spec');
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-sf-toc'), null, 'restored');
  assert.ok(puts.some((p) => p.body.toc === 'shown'), 'persists toc:shown');
});

test('a saved toc:hidden pref collapses the TOC on boot (even on a wide window)', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SECTIONS_BODY, innerWidth: 1500, prefs: { toc: 'hidden' } });
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-sf-toc'), 'hidden', 'explicit hidden wins');
  assert.equal(document.getElementById('sf-tocbtn').textContent, '›');
});

test('with no explicit pref, a narrow window auto-collapses the TOC', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SECTIONS_BODY, innerWidth: 1100 });
  assert.equal(window.document.documentElement.getAttribute('data-sf-toc'), 'hidden',
    'auto-collapsed because the TOC would crowd the centered content');
});

test('no TOC / no docs mode on a spec with too few sections', async (t) => {
  const { window } = await bootReviewLayer(t); // default fixture: 1 heading
  const { document } = window;
  assert.equal(document.getElementById('sf-toc'), null, 'no floating TOC');
  assert.equal(document.getElementById('sf-tocbtn'), null, 'no chevron');
  assert.equal(document.documentElement.getAttribute('data-sf-docs'), null, 'no docs mode');
});

// ---------- collapsible TOC subsections ----------
// House specs title sections with <h2> and use <h3> for subsections (stage
// names, sub-topics). The floating TOC nests those h3s under their section and
// lets each section collapse/expand; the choice persists per spec in
// localStorage (survives SSE reloads without a server round-trip).
const SUBSECTIONS_BODY = `
  <main>
    <section id="s-intro"><h2>Intro</h2><p>x</p></section>
    <section id="s-design"><h2>Design</h2><h3>Data model</h3><p>x</p><h3>API</h3><p>x</p></section>
    <section id="s-plan"><h2>Plan</h2><h3>Stage 1</h3><h3>Stage 2</h3></section>
  </main>
  <div id="sf-live">● live</div>
`;
const COLLAPSE_KEY = 'sf:toc-collapsed:test-spec';
const groupByHref = (document, href) =>
  Array.prototype.find.call(document.querySelectorAll('#sf-toc .sf-toc-group'),
    (g) => g.querySelector('.sf-toc-top').getAttribute('href') === href);

test('sections with h3s nest them as collapsible subsections in the TOC', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SUBSECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  const groups = document.querySelectorAll('#sf-toc .sf-toc-group');
  assert.equal(groups.length, 2, 'the two sections with h3s become collapsible groups');
  const design = groupByHref(document, '#s-design');
  const kids = design.querySelectorAll('.sf-toc-child');
  assert.equal(kids.length, 2, 'both h3s appear as children');
  assert.deepEqual([].map.call(kids, (a) => a.textContent), ['Data model', 'API'], 'child labels are the h3 text');
  // the h3s were given ids and the child links target them
  kids.forEach((a) => {
    const id = a.getAttribute('href').slice(1);
    assert.ok(id && document.getElementById(id), 'child link targets a real heading id: ' + id);
  });
});

test('a section without subsections stays a plain link (no twisty)', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SUBSECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  const intro = Array.prototype.find.call(document.querySelectorAll('#sf-toc .sf-toc-top'),
    (a) => a.getAttribute('href') === '#s-intro');
  assert.ok(intro, 'Intro is present as a top-level link');
  assert.equal(intro.closest('.sf-toc-group'), null, 'a childless section is NOT wrapped in a collapsible group');
});

test('regression: sections with no h3s produce no twisties and one link each', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  assert.equal(document.querySelectorAll('#sf-toc .sf-toc-tw').length, 0, 'no collapse twisties when nothing nests');
  assert.equal(document.querySelectorAll('#sf-toc a').length, 3, 'still one link per section');
});

test('clicking a twisty collapses/expands the group and persists to localStorage', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SUBSECTIONS_BODY, innerWidth: 1500 });
  const { document } = window;
  const group = groupByHref(document, '#s-plan');
  const tw = group.querySelector('.sf-toc-tw');
  assert.equal(tw.getAttribute('aria-expanded'), 'true', 'starts expanded');
  assert.ok(!group.classList.contains('sf-collapsed'), 'not collapsed initially');
  tw.click();
  assert.ok(group.classList.contains('sf-collapsed'), 'collapsed after click');
  assert.equal(tw.getAttribute('aria-expanded'), 'false', 'aria reflects collapsed');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COLLAPSE_KEY)), ['s-plan'], 'collapsed id persisted');
  tw.click();
  assert.ok(!group.classList.contains('sf-collapsed'), 'expanded again');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COLLAPSE_KEY)), [], 'expanding clears it from storage');
});

test('a persisted collapsed section starts collapsed on boot', async (t) => {
  const { window } = await bootReviewLayer(t, {
    body: SUBSECTIONS_BODY, innerWidth: 1500,
    seedStorage: { [COLLAPSE_KEY]: JSON.stringify(['s-design']) },
  });
  const { document } = window;
  const design = groupByHref(document, '#s-design');
  assert.ok(design.classList.contains('sf-collapsed'), 'restored as collapsed from localStorage');
  assert.equal(design.querySelector('.sf-toc-tw').getAttribute('aria-expanded'), 'false');
  const plan = groupByHref(document, '#s-plan');
  assert.ok(!plan.classList.contains('sf-collapsed'), 'a section not in storage stays expanded');
});

test('collapsing marks the subsection list inert (out of tab order + a11y tree); expanding clears it', async (t) => {
  const { window } = await bootReviewLayer(t, { body: SUBSECTIONS_BODY, innerWidth: 1500 });
  const group = groupByHref(window.document, '#s-plan');
  const sub = group.querySelector('.sf-toc-sub');
  const tw = group.querySelector('.sf-toc-tw');
  assert.equal(sub.inert, false, 'an expanded subsection is not inert');
  tw.click();
  assert.equal(sub.inert, true, 'collapsing makes the subsection inert immediately');
  tw.click();
  assert.equal(sub.inert, false, 'expanding clears inert');
});

test('a boot-collapsed section starts with its subsection list inert', async (t) => {
  const { window } = await bootReviewLayer(t, {
    body: SUBSECTIONS_BODY, innerWidth: 1500,
    seedStorage: { [COLLAPSE_KEY]: JSON.stringify(['s-design']) },
  });
  const sub = groupByHref(window.document, '#s-design').querySelector('.sf-toc-sub');
  assert.equal(sub.inert, true, 'a restored-collapsed group is inert on boot');
});

test('native-TOC specs keep curated top labels but still nest h3 subsections', async (t) => {
  const body = `
    <div class="layout">
      <nav class="toc"><a href="#s-intro">1 · Intro</a><a href="#s-design">2 · Design</a><a href="#s-plan">3 · Plan</a></nav>
      <main>
        <section id="s-intro"><h2>Intro</h2><p>x</p></section>
        <section id="s-design"><h2>Design</h2><h3>Data model</h3><h3>API</h3></section>
        <section id="s-plan"><h2>Plan</h2><p>x</p></section>
      </main>
    </div>
    <div id="sf-live">● live</div>
  `;
  const { window } = await bootReviewLayer(t, { body, innerWidth: 1500 });
  const { document } = window;
  const tops = [].map.call(document.querySelectorAll('#sf-toc .sf-toc-top'), (a) => a.textContent);
  assert.deepEqual(tops, ['1 · Intro', '2 · Design', '3 · Plan'], 'curated native labels reused for the top level');
  const design = groupByHref(document, '#s-design');
  assert.ok(design, 'the section with h3s is collapsible even under a native TOC');
  assert.equal(design.querySelectorAll('.sf-toc-child').length, 2, 'its h3s are nested');
});

test('a native TOC that also lists h3 subsections does not render them twice', async (t) => {
  const body = `
    <div class="layout">
      <nav class="toc">
        <a href="#s-intro">1 · Intro</a>
        <a href="#s-design">2 · Design</a>
        <a href="#d-data" class="sub">2.1 Data model</a>
        <a href="#d-api" class="sub">2.2 API</a>
        <a href="#s-plan">3 · Plan</a>
      </nav>
      <main>
        <section id="s-intro"><h2>Intro</h2><p>x</p></section>
        <section id="s-design"><h2>Design</h2><h3 id="d-data">Data model</h3><h3 id="d-api">API</h3>
          <h4 id="d-deep">Field notes</h4></section>
        <section id="s-plan"><h2>Plan</h2><p>x</p></section>
      </main>
    </div>
    <div id="sf-live">● live</div>
  `;
  const { window } = await bootReviewLayer(t, { body, innerWidth: 1500 });
  const { document } = window;
  const tops = [].map.call(document.querySelectorAll('#sf-toc .sf-toc-top'), (a) => a.textContent);
  assert.deepEqual(tops, ['1 · Intro', '2 · Design', '3 · Plan'], 'the flat subsection links are dropped from the top level');
  const design = groupByHref(document, '#s-design');
  assert.equal(design.querySelectorAll('.sf-toc-child').length, 2, 'they appear once, nested under their parent');
  const hrefs = [].map.call(document.querySelectorAll('#sf-toc a'), (a) => a.getAttribute('href'));
  assert.equal(hrefs.filter((h) => h === '#d-data').length, 1, 'exactly one link per subsection');
});

test('a native TOC link deeper than one level below its section is kept', async (t) => {
  const body = `
    <div class="layout">
      <nav class="toc">
        <a href="#s-intro">1 · Intro</a>
        <a href="#s-design">2 · Design</a>
        <a href="#d-deep" class="sub">2.1.1 Field notes</a>
        <a href="#s-plan">3 · Plan</a>
      </nav>
      <main>
        <section id="s-intro"><h2>Intro</h2><p>x</p></section>
        <section id="s-design"><h2>Design</h2><h4 id="d-deep">Field notes</h4></section>
        <section id="s-plan"><h2>Plan</h2><p>x</p></section>
      </main>
    </div>
    <div id="sf-live">● live</div>
  `;
  const { window } = await bootReviewLayer(t, { body, innerWidth: 1500 });
  const hrefs = [].map.call(window.document.querySelectorAll('#sf-toc a'), (a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#d-deep'), 'an h4 has no h3 group to nest into, so its curated link survives');
});

test('a native TOC link for an h3 inside an id-less nested section is kept (never dropped nor nested)', async (t) => {
  // The h3's immediate section has no id, so childrenOf will not nest it under the
  // outer section — dropNested must therefore leave its curated link in place, or
  // the heading disappears from the rail entirely.
  const body = `
    <div class="layout">
      <nav class="toc">
        <a href="#s-intro">1 · Intro</a>
        <a href="#s-design">2 · Design</a>
        <a href="#d-data" class="sub">2.1 Data model</a>
        <a href="#s-plan">3 · Plan</a>
      </nav>
      <main>
        <section id="s-intro"><h2>Intro</h2><p>x</p></section>
        <section id="s-design"><h2>Design</h2>
          <section><h3 id="d-data">Data model</h3><p>x</p></section>
        </section>
        <section id="s-plan"><h2>Plan</h2><p>x</p></section>
      </main>
    </div>
    <div id="sf-live">● live</div>
  `;
  const { window } = await bootReviewLayer(t, { body, innerWidth: 1500 });
  const { document } = window;
  const hrefs = [].map.call(document.querySelectorAll('#sf-toc a'), (a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#d-data'), 'the curated link survives (its id-less section has no group to nest it)');
  const design = groupByHref(document, '#s-design');
  assert.equal(design, undefined, 'Design nests nothing, so it is a plain link, not a group');
});

// ---------- reading font (Google-Fonts dropdown) ----------
test('a saved font is applied on boot — category + family + on-demand Google load', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'merriweather' } });
  const c = window.document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), 'serif', 'data-sf-font carries the CATEGORY (for code exemption)');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /Merriweather/, 'the family stack is set inline');
  const link = window.document.querySelector('head link[href*="Merriweather"]');
  assert.ok(link && /fonts\.googleapis\.com/.test(link.href), 'the Google font is loaded on boot for a saved web font');
});

test('with no saved font, boot imposes no override and fetches nothing', async (t) => {
  const { window } = await bootReviewLayer(t);
  const c = window.document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), null, 'default → no override, the spec keeps its own font');
  assert.equal(window.document.querySelector('head link[href*="fonts.googleapis.com"]'), null, 'no font fetched until one is picked');
});

test('the Font dropdown groups 3 fonts per category and applies + persists a pick', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const sel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  assert.ok(sel, 'Font dropdown present');
  const groups = sel.querySelectorAll('optgroup');
  assert.equal(groups.length, 4, 'Sans / Serif / Mono / Presentation groups');
  Array.prototype.forEach.call(groups, (g) => assert.equal(g.children.length, 3, g.label + ' has 3 fonts'));
  assert.ok(sel.querySelector('option[value="default"]'), 'a Default option');

  sel.value = 'jetbrains-mono';
  sel.dispatchEvent(new window.Event('change'));
  const c = document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), 'mono', 'a mono pick sets the mono category');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /JetBrains Mono/, 'family applied');
  assert.ok(document.querySelector('head link[href*="JetBrains"]'), 'JetBrains Mono loaded from Google on pick');
  const p = puts.find((x) => /\/prefs$/.test(x.url));
  assert.ok(p && p.body.font === 'jetbrains-mono', 'PUT /prefs persists the font id');
});

test('the Presentation group offers display fonts that keep code monospace', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const sel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  const pres = Array.prototype.find.call(sel.querySelectorAll('optgroup'), (g) => g.label === 'Presentation');
  assert.ok(pres, 'a Presentation group is present');
  assert.equal(pres.children.length, 3, 'Presentation has 3 fonts');
  assert.ok(pres.querySelector('option[value="poppins"]'), 'Poppins is offered');

  sel.value = 'fraunces';
  sel.dispatchEvent(new window.Event('change'));
  const c = document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), 'presentation',
    'a presentation pick sets the presentation category (not mono, so code stays monospace)');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /Fraunces/, 'family applied');
  assert.ok(document.querySelector('head link[href*="Fraunces"]'), 'Fraunces loaded from Google on pick');
  const p = puts.find((x) => /\/prefs$/.test(x.url));
  assert.ok(p && p.body.font === 'fraunces', 'PUT /prefs persists the presentation font id');
});

test('the Font dropdown reflects the persisted font', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'lora' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  assert.equal(rowByLabel(document, 'Font').querySelector('select.sf-font-select').value, 'lora',
    'the dropdown shows the stored font');
});

test('picking Default clears the override', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'inter' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const sel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  sel.value = 'default';
  sel.dispatchEvent(new window.Event('change'));
  const c = document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), null, 'Default removes the category attr');
  assert.equal(c.style.getPropertyValue('--sf-reading-font'), '', 'and the inline family');
});

test('picking a theme PUTs it to /prefs', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Theme').querySelector('.sf-swatch[data-theme="nord"]').click();
  const p = puts.find((x) => /\/prefs$/.test(x.url));
  assert.ok(p, 'a PUT to /prefs fired');
  assert.equal(p.body.theme, 'nord', 'persists the picked theme variant');
});

test('theme + font persist store-wide (/api/prefs); width stays per-spec', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Theme').querySelector('.sf-swatch[data-theme="nord"]').click();
  const fsel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  fsel.value = 'lora'; fsel.dispatchEvent(new window.Event('change'));
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1300'; range.dispatchEvent(new window.Event('change'));

  const theme = puts.find((p) => p.body.theme === 'nord');
  assert.equal(theme.url, '/api/prefs', 'theme → the store-wide endpoint (applies to every spec)');
  const font = puts.find((p) => p.body.font === 'lora');
  assert.equal(font.url, '/api/prefs', 'font → the store-wide endpoint');
  const width = puts.find((p) => p.body.width === 1300);
  assert.match(width.url, /\/api\/spec\/test-spec\/prefs$/, 'width stays per-spec');
});

test('the picker reflects a persisted variant on boot', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { theme: 'dracula' } });
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dracula', 'variant applied on boot');
  document.getElementById('sf-launcher').click();
  assert.equal(rowByLabel(document, 'Theme').querySelector('.sf-swatch.on').getAttribute('data-theme'), 'dracula',
    'the active swatch matches the persisted theme');
});

test('releasing the width slider PUTs the width to /prefs', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1300';
  range.dispatchEvent(new window.Event('change'));
  const p = puts.find((x) => /\/prefs$/.test(x.url));
  assert.ok(p && p.body.width === 1300, 'width persisted on change');
});

test('changing the comments filter PUTs it to /prefs', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.querySelector('.sf-filter button[data-f="resolved"]').click();
  const p = puts.find((x) => /\/prefs$/.test(x.url));
  assert.ok(p && p.body.filter === 'resolved', 'filter persisted on change');
});

test('the footer shows "Not attached" with no Detach when free', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: null } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const foot = document.querySelector('#sf-menu .sf-menu-foot');
  assert.match(foot.querySelector('.sf-foot-session').textContent, /Not attached/, 'shows Not attached');
  assert.equal(foot.querySelector('.sf-detach'), null, 'no Detach button when free');
});

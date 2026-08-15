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
// reconcile.js is injected before review.js and defines window.SFReconcile —
// the block registry the client resolves anchors against.
const RECONCILE_JS = readFileSync(join(ROOT, 'server', 'public', 'reconcile.js'), 'utf8');
// ui.js is injected ahead of both and defines window.SFUI — the snackbar and the
// confirm dialog, shared with the home page.
const UI_JS = readFileSync(join(ROOT, 'server', 'public', 'ui.js'), 'utf8');

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
  // A session owns the spec unless a test says otherwise. That is the ordinary
  // case — a spec is attached to the session that created it — and the action
  // button distinguishes "the agent has it" from "nobody has it", so a fixture
  // that left the owner out would put every state under test in the second one.
  const meta = { id: 'test-spec', title: 'Test', status: 'draft', attachedSession: 's1', ...(opts.meta || {}) };
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
  window.SPECFORGE = {
    specId: 'test-spec',
    prefs: opts.prefs || {},
    // 'poll' is what a published copy is served with; the welcome dialog and the
    // api base both key off it.
    transport: opts.transport || 'sse',
    api: opts.api,
  };
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
    if (String(url).indexOf('/blocks') !== -1) {
      // opts.blocksFail simulates a missing/unreachable registry — comments must
      // keep working without it.
      if (opts.blocksFail) return Promise.reject(new Error('no registry'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ registry: opts.registry || null }) });
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
  if (!opts.noUi) window.eval(UI_JS); // injected ahead of review.js in production
  if (!opts.noReconcile) window.eval(RECONCILE_JS); // injected ahead of review.js in production
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
  // The owner's audience chip defaults to the agent and writes the mention.
  assert.equal(posts[0].body.body, '@agent a block comment');
});

test('clicking the review UI does not open a composer', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  assert.equal(document.querySelector('#sf-rail .sf-bub-compose'), null, 'no composer from a UI click');
});

test('the review command bar lives in the sidebar footer, not the launcher menu', async (t) => {
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'human', body: '@agent x' }],
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
  assert.match(foot.querySelector('.sf-foot-caption').textContent, /1 for agent/);
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

// The server checks the name on an edit against the name on the comment. A
// browser that creates as `lavee` and edits as nobody cannot edit what it just
// wrote, so every write has to carry the same name.
test('a named browser sends its name on create, reply and edit', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'lavee', kind: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window, patches, posts } = await bootReviewLayer(t, { threads });
  const { document } = window;
  window.localStorage.setItem('sf-author', 'lavee');

  const cEl = document.querySelector('.sf-comment[data-cid="c1"]');
  cEl.querySelector('.sf-edit-c').click();
  cEl.querySelector('.sf-edit textarea').value = 'edited body';
  cEl.querySelector('.sf-edit .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = patches.find((x) => /\/comments\/t1\/comment\/c1$/.test(x.url));
  assert.equal(p.body.author, 'lavee', 'the edit carries the writer\'s name');

  const ta = document.querySelector('#sf-sidebar .sf-reply textarea')
    || document.querySelector('.sf-reply textarea');
  if (ta) {
    ta.value = 'a reply';
    const btn = ta.parentElement.querySelector('button');
    if (btn) {
      btn.click();
      await new Promise((r) => window.setTimeout(r, 0));
      const rp = posts.find((x) => /\/reply$/.test(x.url));
      if (rp) assert.equal(rp.body.author, 'lavee', 'the reply carries it too');
    }
  }
});

test('a browser with no name omits it, matching the pre-authors default', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window, patches } = await bootReviewLayer(t, { threads });
  const cEl = window.document.querySelector('.sf-comment[data-cid="c1"]');
  cEl.querySelector('.sf-edit-c').click();
  cEl.querySelector('.sf-edit textarea').value = 'edited';
  cEl.querySelector('.sf-edit .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = patches.find((x) => /\/comments\/t1\/comment\/c1$/.test(x.url));
  assert.equal(p.body.author, undefined, 'no name sent, so the server default applies');
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

// The rail is where a thread is actually read. It rendered comments with its own
// copy of the markup and lost the Edit control by omission, so the same comment
// was editable in the sidebar and frozen in the bubble.
test('a comment expanded in the rail is editable there too', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window, patches } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('#sf-rail .sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const cEl = document.querySelector('.sf-bub-open .sf-comment[data-cid="c1"]');
  assert.ok(cEl, 'the expanded thread renders the comment');
  const editBtn = cEl.querySelector('.sf-edit-c');
  assert.ok(editBtn, 'with the same Edit control the sidebar offers');

  editBtn.click();
  const ta = cEl.querySelector('.sf-edit textarea');
  assert.equal(ta.value, 'original', 'prefilled with the current body');
  ta.value = 'edited in the rail';
  cEl.querySelector('.sf-edit .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = patches.find((x) => /\/comments\/t1\/comment\/c1$/.test(x.url));
  assert.ok(p, 'Save PATCHes the comment endpoint');
  assert.equal(p.body.body, 'edited in the rail');
});

test('the rail applies the same rules about what may be edited', async (t) => {
  const threads = [{
    id: 't1', state: 'replied',
    comments: [
      { id: 'c1', author: 'human', body: 'submitted', batchId: 'b1' },
      { id: 'c2', author: 'claude', body: 'fixed' },
      { id: 'c3', author: 'human', body: 'not yet submitted' },
    ],
    anchor: EDIT_ANCHOR,
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('#sf-rail .sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const bub = document.querySelector('.sf-bub-open');
  assert.ok(!bub.querySelector('.sf-comment[data-cid="c1"] .sf-edit-c'), 'batched: frozen');
  assert.ok(!bub.querySelector('.sf-comment[data-cid="c2"] .sf-edit-c'), 'the agent\'s own: not yours');
  assert.ok(bub.querySelector('.sf-comment[data-cid="c3"] .sf-edit-c'), 'yours and unsent: editable');
});

test('editing in the rail hides the body until the edit resolves', async (t) => {
  // Leaving the rendered body above a prefilled editor shows the comment twice
  // and makes it unclear which one is live.
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('#sf-rail .sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const cEl = document.querySelector('.sf-bub-open .sf-comment[data-cid="c1"]');
  cEl.querySelector('.sf-edit-c').click();
  assert.equal(cEl.querySelector('.body').style.display, 'none', 'the body is hidden while editing');

  cEl.querySelector('.sf-edit .sf-ghost').click();      // Cancel
  assert.equal(cEl.querySelector('.sf-edit'), null, 'the editor is gone');
  assert.equal(cEl.querySelector('.body').style.display, '', 'and the body is back');
});

test('editing inside the rail card does not collapse the thread', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'human', body: 'original' }],
    anchor: EDIT_ANCHOR,
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  document.querySelector('#sf-rail .sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  document.querySelector('.sf-bub-open .sf-edit-c').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('.sf-bub-open').length, 1, 'still expanded');
  assert.ok(document.querySelector('.sf-bub-open .sf-edit textarea'), 'with the editor open');
});

// ---------- spec header (full-width, always on top) ----------
test('the spec title renders as a header that is visible without scrolling', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const bar = document.getElementById('sf-titlebar');
  assert.ok(bar, 'the header is built');
  // It holds the CTA as well now, so it is a container — the title itself is
  // the native button (nesting a button inside a button would be invalid).
  assert.equal(bar.querySelector('button.sf-tb-home').tagName, 'BUTTON',
    'the title is a native button (focusable, keyboard-activatable)');
  assert.equal(bar.querySelector('.sf-tb-title').textContent, 'Test Spec', 'it shows the spec h1');
  assert.ok(bar.classList.contains('show'), 'visible immediately — it no longer waits for a scroll');
  assert.ok(document.documentElement.hasAttribute('data-sf-header'),
    'the document is flagged so the page offsets beneath the fixed header');
});

test('the header stays put while scrolling', async (t) => {
  const { window } = await bootReviewLayer(t);
  const bar = window.document.getElementById('sf-titlebar');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 900 });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(bar.classList.contains('show'), 'still there deep in the document');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(bar.classList.contains('show'), 'and back at the top — always on top, never fading out');
});

test('a spec with no title at all gets no header and no offset', async (t) => {
  const body = `<main><p>No heading here.</p></main><div id="sf-live">● live</div>`;
  const meta = { id: 'test-spec', title: '', status: 'draft', attachedSession: null };
  const { window } = await bootReviewLayer(t, { body, meta });
  const { document } = window;
  assert.ok(!document.getElementById('sf-titlebar').classList.contains('show'), 'no header shown');
  assert.ok(!document.documentElement.hasAttribute('data-sf-header'),
    'and the page is not offset for a header that is not there');
});

test('clicking the header scrolls back to the top', async (t) => {
  const { window } = await bootReviewLayer(t);
  let scrolledTo = null;
  window.scrollTo = (o) => { scrolledTo = o; };
  window.document.querySelector('#sf-titlebar .sf-tb-home').click();
  assert.ok(scrolledTo && scrolledTo.top === 0, 'clicking the title scrolls to top');
});

test('the header falls back to the stored spec title when there is no h1', async (t) => {
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
  // Rail geometry only exists on a window wide enough to show the rail at all
  // (jsdom defaults to 1024).
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
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

test('an expanded thread that would overflow the bottom is lifted so it fits', async (t) => {
  // Anchor near the bottom with a tall card: pinning it to the anchor would run
  // the thread off the page and force a scroll to read it.
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': 700 }, 300);       // 700 + 300 = 1000, past the fold
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 20));
  // 800 (viewport) - 300 (card) - 8 (edge) = 492
  assert.equal(parseFloat(document.querySelector('.sf-bub-open').style.top), 492,
    'lifted just enough to sit fully on screen');
});

test('a thread taller than the page stops at the top edge rather than above it', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': 700 }, 900);       // taller than the viewport itself
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 20));
  assert.equal(parseFloat(document.querySelector('.sf-bub-open').style.top), 8,
    'clamped to the top margin — never lifted off the top of the page');
});

test('an expanded thread that already fits is left pinned to its anchor', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': 200 }, 120);       // 200 + 120 = 320, comfortably inside
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 20));
  assert.equal(parseFloat(document.querySelector('.sf-bub-open').style.top), 200,
    'no lift when there is room — the exact anchor pin still wins');
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
  assert.equal(p.body.body, '@agent a reply from the rail', 'with the owner default mention');
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

test('the hover pairing survives a rail rebuild', async (t) => {
  // Rebuilding the rail throws away the focused bubbles, but hoverEl still
  // points at the same block — so onHover's "same element" short-circuit would
  // never restore the pairing. Commenting on the block you are hovering is the
  // everyday way to hit this.
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  const block = document.querySelector('p.a');
  mouse(window, block, 'mousemove');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(document.querySelectorAll('#sf-rail .sf-bub.sf-bub-focus').length, 2, 'paired on hover');

  mouse(window, block, 'click');            // opens a composer → rebuilds the rail
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(block.classList.contains('sf-hover'), 'still the hovered block');
  assert.equal(document.querySelectorAll('#sf-rail .sf-bub.sf-bub-focus').length, 3,
    'its bubbles (and the new composer) are still paired with it after the rebuild');
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
  assert.equal(p.body.body, '@agent a brand new thread', 'with the owner default mention');
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

// Escape closing a confirmation must not also reach the layer behind it: the
// same keypress would cancel the composer and take an unposted draft with it.
test('Escape aimed at a dialog does not reach the composer behind it', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await tick(window);
  const box = document.querySelector('.sf-bub-compose textarea');
  box.value = 'half a thought';

  window.SFUI.confirm({ title: 'Detach', body: 'y', onOk: function () {} });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(window);
  assert.ok(document.querySelector('.sf-bub-compose'), 'the composer is still open');
  assert.equal(document.querySelector('.sf-bub-compose textarea').value, 'half a thought',
    'and the draft is still in it');

  // With nothing modal up, Escape means what it always meant.
  document.getElementById('sf-dc-cancel').click();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(window);
  assert.ok(!document.querySelector('.sf-bub-compose'), 'dismissed');
});

test('expanding a thread closes an open composer — only one focused card', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  stubGeometry(window, { 'p.a': 200, 'p.b': 600 }, 40);
  mouse(window, document.querySelector('p.b'), 'click');       // composer on B
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(document.querySelector('.sf-bub-compose'), 'composer is open');
  document.querySelector('.sf-bub[data-tid="t1"]').click();    // expand a thread
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(!document.querySelector('.sf-bub-compose'), 'the composer is dismissed');
  assert.equal(document.querySelectorAll('#sf-rail [data-focus="1"]').length, 1,
    'exactly one focused card — two would break the single-focus layout');
});

test('activating a thread from the drawer also closes an open composer', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  stubGeometry(window, { 'p.a': 200, 'p.b': 600 }, 40);
  mouse(window, document.querySelector('p.b'), 'click');        // composer on B
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(document.querySelector('.sf-bub-compose'), 'composer is open');
  document.querySelector('.sf-thread[data-tid="t2"]').click();  // activate from the DRAWER
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(!document.querySelector('.sf-bub-compose'), 'the composer is dismissed');
  assert.equal(document.querySelectorAll('#sf-rail [data-focus="1"]').length, 1,
    'still exactly one focused card, whichever path activated the thread');
});

test('the off-screen chip can navigate to an off-screen composer', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const b = document.querySelector('p.b');
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  mouse(window, b, 'click');                       // composer anchored to p.b
  await new Promise((r) => window.setTimeout(r, 0));
  stubGeometry(window, { 'p.b': -400 }, 40);       // its anchor scrolls off the top
  await settleRail(window);
  const chip = document.querySelector('#sf-rail .sf-rail-above');
  assert.ok(chip, 'the composer counts toward the off-screen indicator');
  let scrolled = 0;
  b.scrollIntoView = () => { scrolled++; };
  chip.click();
  assert.equal(scrolled, 1, 'and the chip can actually take you back to it');
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

test('an anchor hidden behind the fixed header is both counted and reachable', async (t) => {
  // The rail starts below the header, so its coordinate space is offset. An
  // anchor at viewport-top 20 is *visible* by viewport maths but sits behind a
  // 46px header — counting and navigation must agree that it is "above".
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'under the header' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads });
  const { document } = window;
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stubGeometry(window, { 'p.a': 20 }, 40);
  document.getElementById('sf-rail').getBoundingClientRect = () => ({
    top: 46, bottom: 800, left: 0, right: 272, width: 272, height: 754,
  });
  await settleRail(window);

  const chip = document.querySelector('#sf-rail .sf-rail-above');
  assert.ok(chip, 'counted as above — it is behind the header, not visible');
  let scrolled = 0;
  document.querySelector('p.a').scrollIntoView = () => { scrolled++; };
  chip.click();
  assert.equal(scrolled, 1, 'and the chip actually reaches it — same coordinate space both ways');
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

// ---------- block registry: identity that survives edits ----------
const BID_ANCHOR = (bid) => ({
  block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [], bid },
});

test('the registry is built and stored the first time a spec is opened', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  await new Promise((r) => window.setTimeout(r, 10));
  const put = puts.find((x) => /\/blocks$/.test(x.url));
  assert.ok(put, 'the reconciled registry is persisted');
  assert.equal(put.body.schema, 1);
  assert.ok(put.body.blocks.length >= 3, 'every commentable block is registered');
  assert.ok(put.body.blocks.every((b) => b.bid && b.tag && b.hash), 'each entry is {bid, tag, hash}');
  assert.equal(new Set(put.body.blocks.map((b) => b.bid)).size, put.body.blocks.length, 'ids are distinct');
});

test('a new comment records the block id alongside the legacy anchor fields', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  await new Promise((r) => window.setTimeout(r, 10));
  mouse(window, window.document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  card.querySelector('textarea').value = 'anchored by id';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  const b = p.body.anchor.block;
  assert.ok(b.bid, 'carries an id');
  // The rollback guarantee: an older client reads these, so they must still be here.
  assert.equal(b.text, 'The quick brown fox.', 'still carries the text');
  assert.equal(typeof b.index, 'number', 'still carries the index');
  assert.ok(Array.isArray(b.sectionPath), 'still carries the section path');
});

test('a comment written before ids adopts one, and says so to the server', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'legacy' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window, patches } = await bootReviewLayer(t, { threads });
  await new Promise((r) => window.setTimeout(r, 10));
  const patch = patches.find((x) => /\/comments\/t1\/anchor$/.test(x.url));
  assert.ok(patch, 'the adopted id is persisted');
  assert.ok(patch.body.bid, 'and it is a real id');
});

test('an ambiguous legacy anchor is NOT given an id — a guess must not be frozen', async (t) => {
  // Two blocks with identical text and an index that no longer picks either:
  // we genuinely don't know which was meant, and adopting an id is permanent.
  const body = `<main>
    <h1>Test Spec</h1>
    <p class="a">Duplicated line.</p>
    <p class="b">Something else.</p>
    <p class="c">Duplicated line.</p>
  </main><div id="sf-live">● live</div>`;
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 99, tag: 'P', text: 'Duplicated line.', sectionPath: [] } } }];
  const { window, patches } = await bootReviewLayer(t, { body, threads });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.equal(patches.filter((x) => /\/anchor$/.test(x.url)).length, 0,
    'no id adopted while the match is ambiguous');
  assert.ok(window.document.querySelector('.sf-block-mark'), 'but it still resolves, as it always did');
});

test('duplicated text never adopts an id, even when the stored index still matches', async (t) => {
  // The index landing on a matching block proves nothing here: content shifting
  // above changes which duplicate occupies it, so this could be the other one.
  const body = `<main>
    <h1>Test Spec</h1>
    <p class="a">Duplicated line.</p>
    <p class="b">Duplicated line.</p>
  </main><div id="sf-live">● live</div>`;
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 1, tag: 'P', text: 'Duplicated line.', sectionPath: [] } } }];
  const { window, patches } = await bootReviewLayer(t, { body, threads });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.equal(patches.filter((x) => /\/anchor$/.test(x.url)).length, 0,
    'still a guess, so still not frozen');
});

test('an unambiguous legacy anchor with a stale index still adopts an id', async (t) => {
  // Only one block has this text, so the stale index does not make it ambiguous.
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 99, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window, patches } = await bootReviewLayer(t, { threads });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.equal(patches.filter((x) => /\/anchor$/.test(x.url)).length, 1, 'adopted — there is only one candidate');
});

test('a thread whose block was deleted stays on the page, marked', async (t) => {
  // Build the registry the way production does — reconcile the real fixture —
  // then append one extra block that is NOT on the page. Every real block stays
  // pinned, so the extra one is unambiguously a deletion rather than an edit.
  const seedRun = await bootReviewLayer(t);
  await new Promise((r) => seedRun.window.setTimeout(r, 10));
  const real = seedRun.puts.find((x) => /\/blocks$/.test(x.url)).body;
  const registry = {
    schema: 1, version: real.version, seq: real.seq + 1,
    blocks: real.blocks.concat([{ bid: 'bGONE', tag: 'P', hash: 'deadbeef' }]),
  };
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'about the deleted bit' }],
    anchor: { block: { index: 0, tag: 'P', text: 'a paragraph that was deleted', sectionPath: [], bid: 'bGONE' } } }];
  const { window } = await bootReviewLayer(t, { threads, registry });
  await new Promise((r) => window.setTimeout(r, 10));
  const bub = window.document.querySelector('#sf-rail .sf-bub-orphan');
  assert.ok(bub, 'the thread is still shown, not silently dropped');
  bub.click();
  await new Promise((r) => window.setTimeout(r, 0));
  const open = window.document.querySelector('.sf-bub-open.sf-bub-orphan');
  assert.match(open.querySelector('.sf-orphan-note').textContent, /removed/i, 'it says what happened');
  assert.match(open.querySelector('.sf-orphan-quote').textContent, /deleted/, 'and keeps the original quote');
});

// ---------- backwards compatibility, tested rather than assumed ----------
test('comments resolve normally when the registry cannot be read', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads, blocksFail: true });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.ok(window.document.querySelector('.sf-block-mark'), 'the block is still marked');
  assert.equal(window.document.querySelectorAll('#sf-rail .sf-bub').length, 1, 'the bubble is still there');
});

test('a comment carrying an id still resolves through the legacy path', async (t) => {
  // The rollback case: the id means nothing without a registry, so the anchor's
  // text has to carry it — which is why the fields are additive.
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: BID_ANCHOR('b-from-a-newer-client') }];
  const { window } = await bootReviewLayer(t, { threads, blocksFail: true });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.ok(window.document.querySelector('.sf-block-mark'), 'resolved by text, exactly as an old client would');
  assert.equal(window.document.querySelectorAll('#sf-rail .sf-bub-orphan').length, 0,
    'and is NOT mistaken for a deleted block');
});

test('everything still works with the reconcile script absent entirely', async (t) => {
  const threads = [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'x' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];
  const { window } = await bootReviewLayer(t, { threads, noReconcile: true });
  await new Promise((r) => window.setTimeout(r, 10));
  assert.ok(window.document.querySelector('.sf-block-mark'), 'comments resolve');
  assert.equal(window.document.querySelectorAll('#sf-rail .sf-bub').length, 1, 'and render');
});

// ---------- rail horizontal placement (hugs the content, capped at the edge) ----------
// Give the content container a measurable right edge so the rail can sit beside it.
function stubContainer(window, right) {
  const el = window.document.querySelector('main');
  el.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right, width: right, height: 800 });
  return el;
}
const railLeft = (window) => parseFloat(window.document.getElementById('sf-rail').style.left);

test('the rail sits just outside the content container, not at the viewport edge', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  stubContainer(window, 900);
  stubGeometry(window, { 'p.a': 200 }, 40);
  await settleRail(window);
  assert.equal(railLeft(window), 908, 'placed one margin (8px) to the right of the content edge');
  assert.equal(window.document.getElementById('sf-rail').style.right, 'auto',
    'driven by left, so the viewport-edge default no longer applies');
});

test('a wide container caps the rail at the viewport edge instead of pushing it off-screen', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  stubContainer(window, 1500);   // content nearly fills the window
  stubGeometry(window, { 'p.a': 200 }, 40);
  await settleRail(window);
  // 1600 - 272 (rail) - 8 (margin) = 1320; without the cap it would be 1508.
  assert.equal(railLeft(window), 1320, 'clamped so the rail stays fully on screen');
});

test('the rail follows the content edge when the reading width changes', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  stubContainer(window, 700);
  stubGeometry(window, { 'p.a': 200 }, 40);
  await settleRail(window);
  assert.equal(railLeft(window), 708, 'hugs the narrow column');
  stubContainer(window, 1100);   // e.g. the width slider widens the content
  await settleRail(window);
  assert.equal(railLeft(window), 1108, 'moves out with it');
});

// ---------- rail visibility: drawer + narrow-window fallback ----------
const oneThread = () => [{ id: 't1', state: 'open', comments: [{ id: 'c1', author: 'human', body: 'a' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } }];

test('the rail hides while the drawer is open and returns when it closes', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  const { document } = window;
  const rail = document.getElementById('sf-rail');
  assert.ok(!rail.hasAttribute('hidden'), 'rail shows by default on a wide window');
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();          // open the drawer
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(rail.hasAttribute('hidden'), 'rail yields the right gutter to the drawer');
  document.querySelector('.sf-side-close').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!rail.hasAttribute('hidden'), 'rail returns when the drawer closes');
});

test('the rail hides on a window too narrow to hold it beside the content', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 700 });
  assert.ok(window.document.getElementById('sf-rail').hasAttribute('hidden'),
    'below the threshold the drawer is the fallback');
});

test('you can still comment on a narrow window — the composer forces the rail up', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { innerWidth: 700 });
  const { document } = window;
  assert.ok(document.getElementById('sf-rail').hasAttribute('hidden'), 'rail starts hidden when narrow');
  mouse(window, document.querySelector('p.a'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!document.getElementById('sf-rail').hasAttribute('hidden'),
    'the rail comes up so the composer is visible at all');
  const card = document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'the composer is present and reachable');
  card.querySelector('textarea').value = 'commented on a narrow window';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(posts.find((x) => /\/comments$/.test(x.url)), 'and the thread is actually created');
});

test('composing closes the drawer, which would otherwise hide the composer', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(document.getElementById('sf-sidebar').classList.contains('open'), 'drawer open');
  mouse(window, document.querySelector('p.b'), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(!document.getElementById('sf-sidebar').classList.contains('open'), 'the drawer steps aside');
  assert.ok(document.querySelector('#sf-rail .sf-bub-compose'), 'the composer is visible');
});

test('closing the drawer re-measures the rail instead of revealing stale positions', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 1600 });
  const { document } = window;
  stubGeometry(window, { 'p.a': 300 }, 40);
  await settleRail(window);
  assert.equal(parseFloat(document.querySelector('#sf-rail .sf-bub').style.top), 300);

  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Comments').click();            // drawer open → rail hidden
  await new Promise((r) => window.setTimeout(r, 0));
  // The page scrolls/reflows while the rail is hidden: its layout pass skipped it.
  document.querySelector('p.a').getBoundingClientRect = () => ({ top: 90, bottom: 110, left: 0, right: 100, width: 100, height: 20 });
  document.querySelector('.sf-side-close').click();    // back to the rail
  await new Promise((r) => window.setTimeout(r, 30));
  assert.equal(parseFloat(document.querySelector('#sf-rail .sf-bub').style.top), 90,
    're-measured on the way back, not showing where the page used to be');
});

test('the rail reappears when a narrow window is widened', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: oneThread(), innerWidth: 700 });
  const rail = window.document.getElementById('sf-rail');
  assert.ok(rail.hasAttribute('hidden'), 'hidden while narrow');
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await new Promise((r) => window.setTimeout(r, 20));
  assert.ok(!rail.hasAttribute('hidden'), 'shows again once there is room');
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
  assert.equal(p.body.body, '@agent a second, separate thread');
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
// The comment addresses the agent: only agent-directed threads are submittable,
// and "Submit comments" is what these fixtures are testing. A thread with no
// mention is discussion, and offering to submit it would submit nothing.
const PENDING_THREAD = [{
  id: 't1', state: 'open', comments: [{ author: 'human', body: '@agent x' }],
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

// Discussion fixture — open, no mention and no batchId, so it is outside the
// agent loop entirely. Nothing to submit and nobody working; simply unresolved.
const DISCUSSION_THREAD = [{
  id: 't1', state: 'open', comments: [{ author: 'lavee', body: 'is this still true?' }],
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
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'lgtm');
  btn.click();
  await tick(window);
  const p = posts.find((x) => /\/status$/.test(x.url));
  assert.ok(p && p.body.status === 'approved', 'clicking LGTM POSTs status=approved');
});

test('action button: approved is the end of the line — a display, not an action', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'approved' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'done');
  assert.match(btn.textContent, /Approved/);
  assert.ok(btn.disabled, 'there is nothing after approved');
});

// A thread that is still open cannot sit under an approved spec on the server —
// writing a comment sends it back to draft — so the CTA reads the status first
// and does not need to re-derive that precedence from the threads.
test('action button: a thread still open holds back approval', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: DISCUSSION_THREAD, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'other');
  assert.match(btn.textContent, /Resolve to approve/);
  assert.ok(btn.disabled, 'an open discussion is unfinished business, so LGTM is not offered');
});

// ---------- the same CTA, mirrored in the header ----------
test('the header carries the review CTA, in step with the drawer', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  const { document } = window;
  const head = document.querySelector('#sf-titlebar .sf-act');
  const foot = document.querySelector('#sf-sidebar .sf-act');
  assert.ok(head, 'the header shows the lifecycle action');
  assert.equal(head.getAttribute('data-state'), foot.getAttribute('data-state'),
    'same state as the drawer — one state machine, two surfaces');
  assert.equal(head.textContent, foot.textContent, 'and the same label');
  assert.match(head.textContent, /Submit comments/);
});

test('clicking the header CTA submits the batch', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  window.document.querySelector('#sf-titlebar .sf-act').click();
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)), 'the header button is live, not decorative');
});

test('the header CTA reports the agent working, disabled and spinning', async (t) => {
  // reviewProgress only advances when a session drains the batch, so a spec
  // reporting one always has an owner.
  const meta = { status: 'draft', attachedSession: 's1', reviewProgress: 'working' };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const head = window.document.querySelector('#sf-titlebar .sf-act');
  assert.equal(head.getAttribute('data-state'), 'reviewing');
  assert.match(head.textContent, /Working on comments/);
  assert.ok(head.disabled, 'nothing to do while the agent has it');
  assert.ok(head.querySelector('.sf-spin'), 'and it shows the work is in flight');
});

test('action button: submitted but unresolved → "Awaiting response" (disabled, nothing to submit)', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting');
  assert.match(btn.textContent, /Awaiting/);
  assert.ok(btn.disabled, 'no submit action once the batch is already submitted');
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows while the agent is working');
});

// "Awaiting response" with a spinner over a spec nobody owns reports work in
// flight on an empty queue: the batch is stored and delivered to no one, and
// waiting will not change that. The header says No agent beside it; the button
// must not contradict it.
test('action button: submitted with no session on the spec → "No agent to answer"', async (t) => {
  const meta = { status: 'draft', attachedSession: null };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.match(btn.textContent, /No agent to answer/);
  assert.ok(btn.disabled, 'there is nothing to press: the remedy is Connect, in the header');
  assert.equal(btn.querySelector('.sf-spin'), null, 'and nothing is in flight');
});

test('action button: picked-up batch → "Picked up comments" (disabled)', async (t) => {
  const meta = { status: 'draft', attachedSession: 's1', reviewProgress: 'picked_up' };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'picked');
  assert.match(btn.textContent, /Picked up comments/);
  assert.ok(btn.disabled, 'no action while the agent has it');
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows once the agent picks the batch up');
});

test('action button: working batch → "Working on comments" (disabled)', async (t) => {
  const meta = { status: 'draft', attachedSession: 's1', reviewProgress: 'working' };
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'reviewing');
  assert.match(btn.textContent, /Working on comments/);
  assert.ok(btn.disabled);
  assert.ok(btn.querySelector('.sf-spin'), 'a loading spinner shows while the agent works the comments');
});

test('action button: a replied thread beats reviewProgress → "Review replies"', async (t) => {
  const meta = { status: 'draft', attachedSession: null, reviewProgress: 'working' };
  const { window } = await bootReviewLayer(t, { threads: REPLIED_THREAD, meta });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'replied', 'reply state wins once every open thread is answered');
});


test('action button: a reopened thread with a fresh human comment → "Submit comments"', async (t) => {
  // A previously-submitted thread (old comments carry batchId) the human reopened
  // by adding a new, un-submitted comment — the CTA must light up again.
  const threads = [{
    id: 't1', state: 'open',
    comments: [
      { author: 'human', body: '@agent original', batchId: 'b1' },
      { author: 'claude', body: 'addressed' },
      { author: 'human', body: '@agent actually, reconsider' },
    ],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'needs');
  assert.match(btn.textContent, /Submit comments/);
});

test('action button: agent replied to every open thread → "Review replies", clicking opens the sidebar', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: REPLIED_THREAD, meta: { status: 'draft' } });
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
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting', 'still waiting while any open thread is unanswered');
});

test('action button: an unknown status is an inert display (no silent approve)', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'cancelled' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'other');
  assert.ok(btn.disabled, 'an unrecognized status carries no action');
});

// A store the migration has not been run against. The retired status is shown as
// it stands; offering LGTM over the top of it would erase what it recorded.
test('action button: a retired status displays itself and offers nothing', async (t) => {
  for (const status of ['implementing', 'done', 'closed']) {
    const { window } = await bootReviewLayer(t, { meta: { status } });
    const btn = window.document.querySelector('.sf-act');
    assert.equal(btn.getAttribute('data-state'), 'other', status);
    assert.match(btn.textContent, new RegExp(status));
    assert.ok(btn.disabled, `${status} carries no action`);
  }
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

// ---------- decks: one slide on screen at a time ----------
//
// A deck pages its sections: exactly one carries `is-current`, the rest are
// display:none. A hidden block measures as a zero rect at the top of the page,
// which is why every thread in the deck used to pile onto whichever slide the
// reader was on, and why the off-screen chips counted a scroll distance that did
// not exist.

const DECK_BODY = `
  <main>
    <section id="s1" data-sf-section class="is-current"><p class="a">The quick brown fox.</p></section>
    <section id="s2" data-sf-section><p class="b">Second paragraph for hover.</p></section>
    <section id="s3" data-sf-section><ul><li class="c">A list item block.</li></ul></section>
  </main>
  <nav class="filmstrip">
    <a class="fs-item" href="#s1">one</a>
    <a class="fs-item" href="#s2">two</a>
    <a class="fs-item" href="#s3">three</a>
  </nav>
  <div id="sf-live">● live</div>
`;

/** One open thread per slide, anchored to that slide's only block. */
const DECK_THREADS = [
  { id: 't1', state: 'open', comments: [{ author: 'human', body: 'on one' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: ['s1'] } } },
  { id: 't2', state: 'open', comments: [{ author: 'human', body: 'on two' }],
    anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: ['s2'] } } },
  { id: 't3', state: 'open', comments: [{ author: 'human', body: 'on three' }],
    anchor: { block: { index: 2, tag: 'LI', text: 'A list item block.', sectionPath: ['s3'] } } },
];

// innerWidth: the rail hides itself below 1100px, and a hidden rail skips the
// layout pass that renders the off-screen chips.
const bootDeck = (t, opts = {}) =>
  bootReviewLayer(t, { body: DECK_BODY, threads: DECK_THREADS, innerWidth: 1600, ...opts });
const railTids = (window) => Array.prototype.map.call(
  window.document.querySelectorAll('#sf-rail .sf-bub'), (b) => b.getAttribute('data-tid'));
const chipText = (window) => Array.prototype.map.call(
  window.document.querySelectorAll('.sf-rail-chip'), (c) => c.textContent);

/** Page the fixture deck the way its own script would. */
function pageTo(window, id) {
  Array.prototype.forEach.call(window.document.querySelectorAll('main > section[data-sf-section]'),
    (s) => s.classList.toggle('is-current', s.id === id));
}

test('a deck draws only the current slide\'s comments', async (t) => {
  const { window } = await bootDeck(t);
  assert.deepEqual(railTids(window), ['t1'], 'the other two slides are not on screen to point at');
});

test('paging the deck re-renders the rail for the new slide', async (t) => {
  // The deck's prev/next use history.replaceState, which fires no event at all.
  // What always happens is `is-current` moving, so that is what the layer watches.
  const { window } = await bootDeck(t);
  pageTo(window, 's2');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.deepEqual(railTids(window), ['t2']);
  pageTo(window, 's3');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.deepEqual(railTids(window), ['t3']);
});

test('a scrolling spec is untouched by any of this', async (t) => {
  const threads = [
    { id: 't1', state: 'open', comments: [{ author: 'human', body: 'a' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } } },
    { id: 't2', state: 'open', comments: [{ author: 'human', body: 'b' }],
      anchor: { block: { index: 1, tag: 'P', text: 'Second paragraph for hover.', sectionPath: [] } } },
  ];
  const { window } = await bootReviewLayer(t, { threads });
  assert.deepEqual(railTids(window), ['t1', 't2'], 'every thread still draws — nothing is hidden');
  assert.equal(window.document.querySelector('.sf-fs-count'), null, 'and no slide badges');
});

test('the off-screen chips count slides, and say so', async (t) => {
  const { window } = await bootDeck(t);
  assert.deepEqual(chipText(window), ['↓ 2 later'], 'two slides ahead carry comments');
  pageTo(window, 's2');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.deepEqual(chipText(window), ['↑ 1 earlier', '↓ 1 later']);
  pageTo(window, 's3');
  await new Promise((r) => window.setTimeout(r, 0));
  assert.deepEqual(chipText(window), ['↑ 2 earlier']);
});

test('clicking a chip pages to the nearest slide that has a comment', async (t) => {
  // Via the hash, which is the deck's own paging contract. A scrollIntoView on a
  // display:none block reaches nothing, which is why these read as dead before.
  const { window } = await bootDeck(t);
  window.document.querySelector('.sf-rail-below').click();
  assert.equal(window.location.hash, '#s2', 'the nearest later slide, not the last one');

  pageTo(window, 's3');
  await new Promise((r) => window.setTimeout(r, 0));
  window.document.querySelector('.sf-rail-above').click();
  assert.equal(window.location.hash, '#s2', 'and the nearest earlier one going back');
});

test('the filmstrip carries a comment count per slide', async (t) => {
  const { window } = await bootDeck(t);
  const badges = Array.prototype.map.call(window.document.querySelectorAll('.sf-fs-count'),
    (c) => c.closest('a').getAttribute('href') + '=' + c.textContent);
  assert.deepEqual(badges, ['#s1=1', '#s2=1', '#s3=1'],
    'a slide you are not on is otherwise silent about having comments');
});

test('the counts follow the comments, and a resolved thread stops counting', async (t) => {
  const threads = [
    DECK_THREADS[0],
    { ...DECK_THREADS[1], id: 't2b' },
    { ...DECK_THREADS[1], id: 't2c' },
    { ...DECK_THREADS[2], state: 'resolved' },
  ];
  const { window } = await bootDeck(t, { threads });
  const badges = Array.prototype.map.call(window.document.querySelectorAll('.sf-fs-count'),
    (c) => c.closest('a').getAttribute('href') + '=' + c.textContent);
  assert.deepEqual(badges, ['#s1=1', '#s2=2'], 'two on slide two, and the resolved one is gone');
});

test('opening a thread from the drawer pages to its slide', async (t) => {
  // Without this the drawer lists every thread and clicking one that lives on
  // another slide scrolls to a block nobody can see.
  const { window } = await bootDeck(t);
  const card = window.document.querySelector('#sf-sidebar .sf-thread[data-tid="t3"]');
  assert.ok(card, 'the drawer lists threads from every slide');
  card.click();
  assert.equal(window.location.hash, '#s3');
});

// ---------- ⌘/Ctrl+S submits ----------
//
// Submitting is the one thing you do repeatedly on this page and could not do
// from the keyboard. Bound to submitting specifically rather than to whatever
// the button currently says: the same button also approves a spec, and a reflex
// keystroke that silently approved something is a bad trade for a saved click.

const saveKey = (window, opts = {}) => {
  const e = new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, ...opts });
  window.document.dispatchEvent(e);
  return e;
};

test('Ctrl+S submits the batch when there is one to submit', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  saveKey(window);
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)));
});

test('⌘S does the same, for the same reflex on a Mac', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  saveKey(window, { ctrlKey: false, metaKey: true });
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)));
});

test('it never triggers the browser\'s Save Page, even with nothing to submit', async (t) => {
  // Saving a spec as HTML is not something anyone wants from this page, and a
  // key that sometimes opens a save dialog is worse than one that never does.
  const { window } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'draft' } });
  assert.equal(saveKey(window).defaultPrevented, true);
});

test('it does not approve a spec, even though the same button would', async (t) => {
  // RESOLVED_THREAD + draft is the LGTM state. A reflex keystroke must not
  // approve; only the deliberate click does.
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'draft' } });
  assert.equal(window.document.querySelector('.sf-act').getAttribute('data-state'), 'lgtm',
    'the button is offering approval');
  saveKey(window);
  await tick(window);
  assert.equal(posts.filter((p) => /\/status$/.test(p.url)).length, 0, 'and the key did not take it');
});

test('it does not re-submit a batch the agent already has', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'draft' } });
  saveKey(window);
  await tick(window);
  assert.equal(posts.filter((p) => /\/comments\/submit$/.test(p.url)).length, 0);
});

test('pressing it with only discussion open says why nothing was sent', async (t) => {
  // Otherwise it reads as a dead key. The likely mistake is a forgotten @agent,
  // so name that rather than saying "nothing to submit".
  const { window } = await bootReviewLayer(t, { threads: DISCUSSION_THREAD, meta: { status: 'draft' } });
  saveKey(window);
  await tick(window);
  const flash = window.document.querySelector('.sfui-snack');
  assert.ok(flash, 'something was said');
  assert.match(flash.textContent, /@agent/);
  assert.ok(flash.classList.contains('err'), 'and marked as a refusal, not a note');
});

// Submitting reloads the comment layer, which rebuilds every card from the
// store. An unposted draft is not in the store, so it went — and Ctrl+S is
// exactly the reflex you hit mid-sentence. The six-second poll already refuses
// to run for this reason; submitting has to refuse for the same one.
test('it will not submit over a comment you are still typing', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await tick(window);
  document.querySelector('#sf-rail .sf-bub-compose textarea').value = 'half a thought';

  saveKey(window);
  await tick(window);
  assert.equal(posts.filter((p) => /\/comments\/submit$/.test(p.url)).length, 0, 'nothing was sent');
  assert.equal(document.querySelector('#sf-rail .sf-bub-compose textarea').value, 'half a thought',
    'and the draft is still there');
  assert.match(document.querySelector('.sfui-snack').textContent, /Post your comment first/);
});

test('the same guard covers the button, which could always discard a draft', async (t) => {
  // Pre-existing: clicking Submit with a composer open lost it too. Guarding
  // only the keystroke would leave the same data loss one click away.
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  const { document } = window;
  mouse(window, document.querySelector('p.a'), 'click');
  await tick(window);
  document.querySelector('#sf-rail .sf-bub-compose textarea').value = 'half a thought';

  document.querySelector('.sf-act').click();
  await tick(window);
  assert.equal(posts.filter((p) => /\/comments\/submit$/.test(p.url)).length, 0);
});

test('an empty composer is not a draft and does not block submitting', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  mouse(window, window.document.querySelector('p.a'), 'click');
  await tick(window);
  saveKey(window);
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)), 'nothing to lose, so it goes');
});

test('the submit button advertises the shortcut, and only it does', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'draft' } });
  assert.match(window.document.querySelector('.sf-act').getAttribute('title'), /Ctrl\+S|⌘S/);

  const other = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'draft' } });
  assert.equal(other.window.document.querySelector('.sf-act').getAttribute('title'), null,
    'LGTM has no shortcut, so it must not claim one');
});

// ---------- the connection pill ----------
//
// In the header, not the menu: a spec nobody is watching takes comments all day
// and delivers none of them, which is not something to discover by opening a
// popup. Reconnect copies a prompt because nothing here can reach a Claude
// session — the connection runs the other way.

const connPill = (window) => window.document.querySelector('#sf-titlebar .sf-tb-conn');

test('a connected spec says so, quietly, with nothing to do', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', attachedSession: 'sess-1', sessionLabel: 'session sess-1', connected: true },
  });
  const pill = connPill(window);
  assert.equal(pill.hasAttribute('hidden'), false);
  assert.match(pill.textContent, /Connected/);
  assert.equal(pill.classList.contains('sf-tb-conn-off'), false);
  assert.equal(pill.querySelector('.sf-conn-act'), null, 'nothing to fix');
});

test('a disconnected spec reads as a fault and offers Reconnect', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', attachedSession: 'sess-1', sessionLabel: 'session sess-1', connected: false },
  });
  const pill = connPill(window);
  assert.equal(pill.hasAttribute('hidden'), false);
  assert.match(pill.textContent, /Disconnected/);
  assert.equal(pill.classList.contains('sf-tb-conn-off'), true);
  assert.match(pill.querySelector('.sf-conn-act').textContent, /Reconnect/);
  assert.match(pill.getAttribute('title'), /sit unread/, 'says what the cost is');
});

// This used to be silent, on the grounds that "Disconnected" reads as a fault
// where the truth is that nobody has claimed the spec yet. That was fair while
// the daemon had a headless drain to sweep up batches nobody owned. With it
// gone, comments written here reach no one, so it is the worst of the three
// states to say nothing about.
test('a spec attached to nothing says so, and offers to fix it', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', attachedSession: null, connected: false },
  });
  const pill = connPill(window);
  assert.equal(pill.hasAttribute('hidden'), false);
  assert.match(pill.textContent, /No agent/);
  assert.equal(pill.classList.contains('sf-tb-conn-off'), true);
  assert.match(pill.querySelector('.sf-conn-act').textContent, /^Connect$/,
    'Connect, not Reconnect — it was never connected');
  assert.match(pill.getAttribute('title'), /No session owns this spec/);
});

test('the prompt for an unowned spec does not claim it was attached', async (t) => {
  const copied = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', attachedSession: null, connected: false },
    preBoot: (w) => {
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: (s) => { copied.push(s); return Promise.resolve(); } },
        configurable: true,
      });
    },
  });
  connPill(window).querySelector('.sf-conn-act').click();
  assert.match(copied[0], /No session owns it/);
  assert.doesNotMatch(copied[0], /stopped watching/);
  assert.match(copied[0], /open test-spec/, 'and still says how to take it');
});

test('a published copy is not shown the owner\'s connection state', async (t) => {
  // A reviewer cannot reconnect someone else's spec to someone else's agent, and
  // telling them the author's session is down only invites them to stop writing.
  const { window } = await bootReviewLayer(t, {
    transport: 'poll', seedStorage: { 'sf-author': 'Lavee' },
    meta: { id: 'test-spec', status: 'draft', attachedSession: 'sess-1', connected: false },
  });
  assert.equal(connPill(window).hasAttribute('hidden'), true);
});

test('Reconnect copies a prompt naming this spec and the takeover steps', async (t) => {
  const copied = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', attachedSession: 'sess-1', connected: false },
    preBoot: (w) => {
      w.SPECFORGE = w.SPECFORGE || {};
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: (s) => { copied.push(s); return Promise.resolve(); } },
        configurable: true,
      });
    },
  });
  connPill(window).querySelector('.sf-conn-act').click();
  assert.equal(copied.length, 1, 'the prompt is on the clipboard');
  const text = copied[0];
  assert.match(text, /test-spec/, 'names the spec');
  assert.match(text, /detach test-spec/, 'frees it from the session that stopped watching');
  assert.match(text, /open test-spec/, 'attaches it to the pasting session');
  assert.match(text, /wait-batch/, 'and arms the watcher, or it would disconnect again at once');
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
  // Detaching is not destructive but it is consequential: comments submitted
  // afterwards reach nobody. It asks, like every other action of that weight.
  assert.equal(posts.filter((p) => /\/detach$/.test(p.url)).length, 0, 'nothing sent before the confirm');
  const dlg = document.getElementById('sf-dc');
  assert.ok(dlg.hasAttribute('open'), 'a confirm dialog');
  assert.match(document.getElementById('sf-dc-body').textContent, /sit unread/, 'it says what stops working');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  assert.ok(posts.some((p) => /\/detach$/.test(p.url)), 'confirming posts /detach');
});

test('Cancel on the detach confirm leaves the spec attached', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-12345678' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  document.querySelector('#sf-menu .sf-detach').click();
  await tick(window);
  document.getElementById('sf-dc-cancel').click();
  await tick(window);
  assert.equal(posts.filter((p) => /\/detach$/.test(p.url)).length, 0, 'nothing sent');
  assert.ok(!document.getElementById('sf-dc').hasAttribute('open'), 'and the dialog closes');
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
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').fit, true, 'fit:true persisted to this browser');
  fit.click(); // toggle off → back to the slider width
  assert.equal(document.documentElement.getAttribute('data-sf-fit'), null, 'fit attr removed');
  assert.equal(document.documentElement.style.getPropertyValue('--maxw'), '1400px', 'slider width restored');
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').fit, false, 'fit:false persisted');
  assert.equal(puts.find((p) => /\/prefs$/.test(p.url)), undefined, 'nothing written to the store');
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
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').fit, false, 'exit is persisted');
  assert.equal(puts.find((p) => /\/prefs$/.test(p.url)), undefined, 'nothing written to the store');
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
  const stored = localPrefs(window, 'sf-prefs:test-spec');
  assert.equal(stored.width, 1000, 'the release persists the width');
  assert.equal(stored.fit, false, 'and that it is no longer fit mode');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'nothing written to the store');
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
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').toc, 'hidden', 'persists toc:hidden per-spec');
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-sf-toc'), null, 'restored');
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').toc, 'shown', 'persists toc:shown');
  assert.equal(puts.find((p) => /\/prefs$/.test(p.url)), undefined, 'nothing written to the store');
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
  assert.equal(groups.length, 3, 'Sans / Serif / Presentation groups');
  Array.prototype.forEach.call(groups, (g) => assert.equal(g.children.length, 3, g.label + ' has 3 fonts'));
  assert.ok(sel.querySelector('option[value="default"]'), 'a Default option');

  sel.value = 'lora';
  sel.dispatchEvent(new window.Event('change'));
  const c = document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), 'serif', 'the pick sets its category');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /Lora/, 'family applied');
  assert.ok(document.querySelector('head link[href*="Lora"]'), 'Lora loaded from Google on pick');
  assert.equal(localPrefs(window, 'sf-prefs').font, 'lora', 'the font id is stored for every spec');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'nothing written to the store');
});

// ---------- code font ----------
// A monospace face is not a reading font. It answers "what does code look like",
// which is a different question from "what does prose look like", so it is a
// different control and the two compose.
test('the reading Font dropdown offers no monospace face', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const sel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  const labels = [].map.call(sel.querySelectorAll('optgroup'), (g) => g.label);
  assert.ok(!labels.includes('Mono'), 'Mono is not a reading-font group');
  for (const id of ['jetbrains-mono', 'fira-code', 'ibm-plex-mono']) {
    assert.equal(sel.querySelector(`option[value="${id}"]`), null, `${id} is not offered as a reading font`);
  }
});

test('the Code font dropdown sets the monospace face and leaves the reading font alone', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();

  const fsel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  fsel.value = 'inter';
  fsel.dispatchEvent(new window.Event('change'));

  const sel = rowByLabel(document, 'Code font').querySelector('select.sf-mono-select');
  assert.ok(sel, 'Code font dropdown present');
  assert.equal(sel.querySelectorAll('option').length, 4, 'Default plus the three monos');
  sel.value = 'jetbrains-mono';
  sel.dispatchEvent(new window.Event('change'));

  const c = document.querySelector('main');
  assert.match(c.style.getPropertyValue('--mono'), /JetBrains Mono/, 'the monospace token is the picked face');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /Inter/, 'and the reading font is untouched');
  assert.equal(c.getAttribute('data-sf-font'), 'sans', 'the category still describes the reading font');
  assert.ok(document.querySelector('head link[href*="JetBrains"]'), 'loaded from Google on pick');
  assert.equal(localPrefs(window, 'sf-prefs').mono, 'jetbrains-mono', 'stored for every spec, like the reading font');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'nothing written to the store');
});

test('a saved code font is applied on boot, with no reading font of its own', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { mono: 'fira-code' } });
  const c = window.document.querySelector('main');
  assert.match(c.style.getPropertyValue('--mono'), /Fira Code/);
  assert.equal(c.style.getPropertyValue('--sf-reading-font'), '', 'prose keeps the spec\'s own font');
  assert.equal(c.getAttribute('data-sf-font'), null, 'and no reading-font category is claimed');
  assert.ok(window.document.querySelector('head link[href*="Fira"]'), 'loaded on boot');
});

test('picking Default for the code font restores the spec\'s own monospace', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { mono: 'ibm-plex-mono' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const sel = rowByLabel(document, 'Code font').querySelector('select.sf-mono-select');
  assert.equal(sel.value, 'ibm-plex-mono', 'the dropdown shows the stored face');
  sel.value = 'default';
  sel.dispatchEvent(new window.Event('change'));
  assert.equal(document.querySelector('main').style.getPropertyValue('--mono'), '',
    'the override is removed, so var(--mono) falls back to the spec\'s own');
});

// A pref saved before the split named a mono in the reading-font slot. Applying
// it as a reading font is the behaviour this change exists to end, so it is read
// as what it always meant: that face, for code.
test('a mono saved under the old single-dropdown pref becomes the code font', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'jetbrains-mono' } });
  const { document } = window;
  const c = document.querySelector('main');
  assert.match(c.style.getPropertyValue('--mono'), /JetBrains Mono/, 'applied as the monospace face');
  assert.equal(c.style.getPropertyValue('--sf-reading-font'), '', 'not as the reading font');

  document.getElementById('sf-launcher').click();
  assert.equal(rowByLabel(document, 'Code font').querySelector('select.sf-mono-select').value, 'jetbrains-mono',
    'and the Code font dropdown shows it');
  assert.equal(rowByLabel(document, 'Font').querySelector('select.sf-font-select').value, 'default',
    'while the reading font reads as Default');
});

// The migration must not outlive the choice that replaces it. An upgraded reader
// who picks Default has a legacy mono still sitting under `font`, and re-reading
// it would hand the old face back on every load.
test('choosing Default for the code font sticks, even with a legacy mono still stored', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'jetbrains-mono', mono: 'default' } });
  const c = window.document.querySelector('main');
  assert.equal(c.style.getPropertyValue('--mono'), '', 'the stored Default wins over the migration');
  assert.equal(c.getAttribute('data-sf-mono'), null);

  window.document.getElementById('sf-launcher').click();
  assert.equal(window.document.querySelector('select.sf-mono-select').value, 'default',
    'and the dropdown agrees');
});

test('the two axes compose and persist independently', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { font: 'merriweather', mono: 'fira-code' } });
  const c = window.document.querySelector('main');
  assert.equal(c.getAttribute('data-sf-font'), 'serif');
  assert.match(c.style.getPropertyValue('--sf-reading-font'), /Merriweather/);
  assert.match(c.style.getPropertyValue('--mono'), /Fira Code/);
});

// The rule that carries the fix: code is monospace under every reading font, and
// which monospace is whatever --mono resolves to.
test('code is monospace under every reading font', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/public/review.css', import.meta.url), 'utf8');
  const rule = css.match(/\[data-sf-font\][^{]*\bpre\b[\s\S]*?\}/);
  assert.ok(rule, 'a rule targets pre/code under a reading font');
  assert.ok(!/:not\(\[data-sf-font="mono"\]\)/.test(rule[0]),
    'it is not exempted for one category: every reading font keeps code monospace');
  assert.match(rule[0], /var\(--mono/, 'and it resolves through --mono, which the Code font picker sets');
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
  assert.equal(localPrefs(window, 'sf-prefs').font, 'fraunces', 'the presentation font id is stored');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'nothing written to the store');
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

// How you read a spec is yours. These used to be server state, so one reader
// switching to dark changed it for everyone who opened the spec — and once a
// spec can be published, "everyone" includes strangers.
const localPrefs = (window, key) => JSON.parse(window.localStorage.getItem(key) || '{}');

test('picking a theme stores it in this browser, not on the server', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Theme').querySelector('.sf-swatch[data-theme="nord"]').click();
  assert.equal(localPrefs(window, 'sf-prefs').theme, 'nord', 'persisted locally');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'nothing was written to the store');
});

test('theme and font apply to every spec; width, fit and filter to this one', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByLabel(document, 'Theme').querySelector('.sf-swatch[data-theme="nord"]').click();
  const fsel = rowByLabel(document, 'Font').querySelector('select.sf-font-select');
  fsel.value = 'lora'; fsel.dispatchEvent(new window.Event('change'));
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1300'; range.dispatchEvent(new window.Event('change'));

  const global = localPrefs(window, 'sf-prefs');
  assert.equal(global.theme, 'nord', 'theme is store-wide, so it is not keyed to a spec');
  assert.equal(global.font, 'lora');
  assert.equal(global.width, undefined, 'width is not store-wide');
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').width, 1300, 'width is per-spec');
});

// The guarantee D11 exists for: a reviewer's reading preferences reach nobody.
test('a second reader with different settings does not disturb the first', async (t) => {
  const a = await bootReviewLayer(t);
  a.window.document.getElementById('sf-launcher').click();
  rowByLabel(a.window.document, 'Theme').querySelector('.sf-swatch[data-theme="nord"]').click();
  assert.equal(a.window.document.documentElement.getAttribute('data-theme'), 'nord');

  // A different browser: its own storage, and the same server-seeded prefs.
  const b = await bootReviewLayer(t);
  assert.notEqual(b.window.document.documentElement.getAttribute('data-theme'), 'nord',
    'the second reader did not inherit the first reader\'s theme');
  assert.equal(b.puts.filter((x) => /\/prefs$/.test(x.url)).length, 0,
    'and neither of them wrote a setting to the store');
});

test('the server values seed a browser that has none', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { theme: 'dracula', width: 1100 } });
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'dracula',
    'the stored spec prefs still decide what an unconfigured browser sees');
});

test('the picker reflects a persisted variant on boot', async (t) => {
  const { window } = await bootReviewLayer(t, { prefs: { theme: 'dracula' } });
  const { document } = window;
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dracula', 'variant applied on boot');
  document.getElementById('sf-launcher').click();
  assert.equal(rowByLabel(document, 'Theme').querySelector('.sf-swatch.on').getAttribute('data-theme'), 'dracula',
    'the active swatch matches the persisted theme');
});

test('releasing the width slider persists the width to this browser', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const range = rowByLabel(document, 'Width').querySelector('input[type=range]');
  range.value = '1300';
  range.dispatchEvent(new window.Event('change'));
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').width, 1300, 'width persisted on change');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'and not to the store');
});

test('changing the comments filter persists it to this browser', async (t) => {
  const { window, puts } = await bootReviewLayer(t);
  window.document.querySelector('.sf-filter button[data-f="resolved"]').click();
  assert.equal(localPrefs(window, 'sf-prefs:test-spec').filter, 'resolved', 'filter persisted on change');
  assert.equal(puts.find((x) => /\/prefs$/.test(x.url)), undefined, 'and not to the store');
});

test('the footer shows "Not attached" with no Detach when free', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: null } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const foot = document.querySelector('#sf-menu .sf-menu-foot');
  assert.match(foot.querySelector('.sf-foot-session').textContent, /Not attached/, 'shows Not attached');
  assert.equal(foot.querySelector('.sf-detach'), null, 'no Detach button when free');
});


test('a published copy asks a new reader for a name, once', async (t) => {
  const { window } = await bootReviewLayer(t, { transport: 'poll' });
  const dlg = window.document.getElementById('sf-welcome');
  assert.ok(dlg, 'the dialog is shown on a published copy');
  assert.match(dlg.textContent, /@agent/, 'it explains what makes a comment agent work');

  dlg.querySelector('#sf-welcome-name').value = 'Lavee';
  dlg.querySelector('.sf-welcome-go').click();
  assert.equal(window.localStorage.getItem('sf-author'), 'Lavee', 'the name is kept for this browser');
  assert.equal(window.document.getElementById('sf-welcome'), null, 'and the dialog closes');
});

test('the owner\'s own copy is never asked', async (t) => {
  const { window } = await bootReviewLayer(t); // transport defaults to sse
  assert.equal(window.document.getElementById('sf-welcome'), null);
});

// review.js is deferred, so readyState is never 'loading' and boot() runs at
// the readyState check near the top of the file. Any `var` the boot path reads
// must be assigned above that check: one declared further down is still
// `undefined` there, and this lookup would silently miss and re-ask a reader who
// already has a name on every single load.
test('a reader who already named themselves is not asked again', async (t) => {
  const { window } = await bootReviewLayer(t, {
    transport: 'poll', seedStorage: { 'sf-author': 'Lavee' },
  });
  assert.equal(window.document.getElementById('sf-welcome'), null);
});

// Storage can be blocked (a private window, third-party-storage settings). The
// name must still reach the comments: dropping it silently would attribute
// everything the reviewer writes to nobody while the dialog looked like it
// worked.
test('a name survives blocked storage for the session', async (t) => {
  const { window, posts } = await bootReviewLayer(t, {
    transport: 'poll',
    preBoot: (w) => {
      w.localStorage.setItem = () => { throw new Error('storage blocked'); };
      w.localStorage.getItem = () => { throw new Error('storage blocked'); };
    },
  });
  const { document } = window;
  document.querySelector('#sf-welcome-name').value = 'Lavee';
  document.querySelector('.sf-welcome-go').click();
  assert.equal(document.getElementById('sf-welcome'), null, 'the dialog still closes');

  document.querySelector('main p, p').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const ta = document.querySelector('#sf-rail textarea');
  ta.value = 'a comment';
  document.querySelector('#sf-rail .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const created = posts.find((p) => !/\/(submit|resolve|reply)$/.test(p.url));
  assert.equal(created.body.author, 'Lavee', 'the comment still carries the name they typed');
});

test('the dialog refuses an empty or reserved name', async (t) => {
  const { window } = await bootReviewLayer(t, { transport: 'poll' });
  const dlg = window.document.getElementById('sf-welcome');
  const err = dlg.querySelector('.sf-welcome-err');

  dlg.querySelector('.sf-welcome-go').click();
  assert.equal(err.hasAttribute('hidden'), false, 'an empty name is refused');
  assert.ok(window.document.getElementById('sf-welcome'), 'and the dialog stays');

  dlg.querySelector('#sf-welcome-name').value = 'agent';
  dlg.querySelector('.sf-welcome-go').click();
  assert.match(err.textContent, /reserved/);
  assert.equal(window.localStorage.getItem('sf-author'), null, 'nothing was stored');
});

test('the footer counts agent threads and discussion separately', async (t) => {
  const threads = [
    {
      id: 't1', state: 'open', comments: [{ author: 'nitin', body: '@agent widen this' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
    },
    {
      id: 't2', state: 'open', comments: [{ author: 'lavee', body: 'why 40 bits?' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
    },
  ];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const caption = window.document.querySelector('.sf-foot-caption').textContent;
  assert.match(caption, /1 for agent/);
  assert.match(caption, /1 discussion/);
});

test('a spec with only discussion offers no submit', async (t) => {
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'lavee', body: 'why 40 bits?' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.notEqual(btn.getAttribute('data-state'), 'needs',
    'discussion alone must not offer a submit that would submit nothing');
  assert.match(window.document.querySelector('.sf-foot-caption').textContent, /1 discussion/);
});

test('@agent renders as addressing, and a person\'s mention differently', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'nitin', body: '@lavee should @agent take this?' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const body = window.document.querySelector('.sf-comment[data-cid="c1"] .body');
  const ats = body.querySelectorAll('.sf-at');
  assert.equal(ats.length, 2, 'both mentions are marked');
  assert.equal(body.querySelectorAll('.sf-at-agent').length, 1, 'only the agent one is marked as the addressee');
  assert.equal(body.querySelector('.sf-at-agent').textContent, '@agent');
});

test('a quoted mention is not rendered as addressing', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ id: 'c1', author: 'nitin', body: 'the token is `@agent`' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const body = window.document.querySelector('.sf-comment[data-cid="c1"] .body');
  assert.equal(body.querySelectorAll('.sf-at').length, 0, 'inside code it is quotation');
  assert.ok(body.querySelector('code'), 'and still renders as code');
});

test('a bubble carries the author\'s own initial', async (t) => {
  const threads = [{
    id: 't1', state: 'open', comments: [{ author: 'lavee', body: 'a point' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads });
  const who = window.document.querySelector('#sf-rail .sf-bub-who');
  assert.equal(who.textContent, 'L', 'the initial comes from the name, not a fixed letter');
  assert.equal(who.getAttribute('title'), 'lavee');
});

test('a published spec shows a Shared badge; an unpublished one does not', async (t) => {
  const shared = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', share: { url: 'https://calm-fox-1234.trycloudflare.com' } },
  });
  const badge = shared.window.document.querySelector('.sf-tb-shared');
  assert.ok(badge, 'the badge exists');
  assert.equal(badge.hasAttribute('hidden'), false, 'and is shown while published');

  const plain = await bootReviewLayer(t, { meta: { id: 'test-spec', title: 'T', status: 'draft' } });
  assert.equal(plain.window.document.querySelector('.sf-tb-shared').hasAttribute('hidden'), true);
});


// ---- the project chip ----

test('a spec in a project names it in the header, and links home filtered to it', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', project: 'figur-design-studio' },
  });
  const chip = window.document.querySelector('.sf-tb-proj');
  assert.ok(chip, 'the chip exists');
  assert.equal(chip.hasAttribute('hidden'), false);
  assert.equal(chip.textContent, 'figur-design-studio');
  assert.equal(chip.getAttribute('href'), '/?project=figur-design-studio',
    'the next question after "which project" is "what else is in it"');
});

test('a spec in no project shows no chip', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { id: 'test-spec', title: 'T', status: 'draft', project: null } });
  assert.equal(window.document.querySelector('.sf-tb-proj').hasAttribute('hidden'), true);
});

test('meta with no project key at all shows no chip', async (t) => {
  // What a spec written before the field looks like, and what a published copy
  // is served: the reader's meta subset does not carry it.
  const { window } = await bootReviewLayer(t, { meta: { id: 'test-spec', title: 'T', status: 'draft' } });
  assert.equal(window.document.querySelector('.sf-tb-proj').hasAttribute('hidden'), true);
});

test('a project name is escaped into the chip and encoded into its link', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', project: 'a&b <img src=x>' },
  });
  const chip = window.document.querySelector('.sf-tb-proj');
  assert.equal(chip.textContent, 'a&b <img src=x>', 'set as text, so markup cannot execute');
  assert.equal(chip.querySelector('img'), null);
  assert.equal(chip.getAttribute('href'), '/?project=' + encodeURIComponent('a&b <img src=x>'));
});

const discussionThread = (id) => ({
  id, state: 'open', comments: [{ author: 'lavee', body: 'why 40 bits?' }],
  anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
});

test('a discussion comment does not report the agent as busy', async (t) => {
  const { window } = await bootReviewLayer(t, {
    threads: [discussionThread('t1')], meta: { status: 'draft' },
  });
  const btn = window.document.querySelector('.sf-act');
  assert.notEqual(btn.getAttribute('data-state'), 'awaiting',
    'nothing was submitted, so nothing can be awaited');
  assert.doesNotMatch(btn.textContent, /Awaiting response/);
  assert.equal(btn.querySelector('.sf-spin'), null, 'and no work is in flight');
});

test('the header CTA agrees with the drawer on a discussion comment', async (t) => {
  const { window } = await bootReviewLayer(t, {
    threads: [discussionThread('t1')], meta: { status: 'draft' },
  });
  const head = window.document.querySelector('.sf-tb-act');
  const foot = window.document.querySelector('#sf-sidebar .sf-act');
  assert.doesNotMatch(head.textContent, /Awaiting response/);
  assert.equal(head.getAttribute('data-state'), foot.getAttribute('data-state'),
    'both surfaces read the same state');
});

test('a submitted agent thread still drives the agent states', async (t) => {
  const threads = [
    discussionThread('t1'),
    {
      id: 't2', state: 'open',
      comments: [{ author: 'nitin', body: '@agent widen this', batchId: 'b1' }],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
    },
  ];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting',
    'the submitted agent thread is genuinely awaiting a reply');
});

test('an answered agent thread reads as replied even with discussion open', async (t) => {
  const threads = [
    discussionThread('t1'),
    {
      id: 't2', state: 'replied',
      comments: [
        { author: 'nitin', body: '@agent widen this', batchId: 'b1' },
        { author: 'claude', kind: 'agent', body: 'done' },
      ],
      anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
    },
  ];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'replied');
  assert.match(btn.textContent, /Review replies/);
});

// A spec that was mid-review when this shipped: its threads were submitted and
// carry no @agent, because nothing needed one then. They must keep their place
// in the loop rather than reading as discussion.
test('a legacy submitted thread still reports as awaiting a reply', async (t) => {
  const threads = [{
    id: 't1', state: 'open',
    comments: [{ author: 'human', body: 'tighten this', batchId: 'b1' }],
    anchor: { block: { index: 0, tag: 'P', text: 'The quick brown fox.', sectionPath: [] } },
  }];
  const { window } = await bootReviewLayer(t, { threads, meta: { status: 'draft' } });
  const btn = window.document.querySelector('.sf-act');
  assert.equal(btn.getAttribute('data-state'), 'awaiting');
  assert.match(window.document.querySelector('.sf-foot-caption').textContent, /for agent|^$/);
});

test('the launcher pill still counts discussion', async (t) => {
  const { window } = await bootReviewLayer(t, {
    threads: [discussionThread('t1')], meta: { status: 'draft' },
  });
  assert.equal(window.document.querySelector('#sf-launcher .sf-l-n').textContent, '1');
});



const rowByText = (document, re) =>
  Array.prototype.find.call(document.querySelectorAll('#sf-menu .sf-menu-row'),
    (r) => re.test(r.textContent || ''));

test('the menu offers to share an unpublished spec', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { id: 'test-spec', status: 'draft' } });
  window.document.getElementById('sf-launcher').click();
  assert.ok(rowByText(window.document, /Share this spec/), 'a Share row is offered');
});

test('sharing posts to the share endpoint and shows progress', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { meta: { id: 'test-spec', status: 'draft' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  rowByText(document, /Share this spec/).click();
  assert.ok(posts.some((p) => /\/share$/.test(p.url)), 'it posts to /share');
  assert.ok(rowByText(document, /Publishing…/), 'the row shows progress');
});

test('a published spec shows its link, Copy and Unshare', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', share: { url: 'https://calm-fox-1234.trycloudflare.com' } },
  });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const link = document.querySelector('#sf-menu .sf-share-on a.sf-doc-link');
  assert.ok(link, 'the link is a real anchor, so it is keyboard-reachable');
  assert.equal(link.getAttribute('href'), 'https://calm-fox-1234.trycloudflare.com');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.querySelector('.sf-share-url').textContent, 'calm-fox-1234.trycloudflare.com');
  assert.ok(document.querySelector('#sf-menu .sf-share-copy'), 'a Copy button');
  assert.ok(document.querySelector('#sf-menu .sf-share-off'), 'an Unshare button');
  assert.equal(rowByText(document, /Share this spec/), undefined, 'and no second offer to share');
});

test('Unshare DELETEs the share', async (t) => {
  const deletes = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', share: { url: 'https://calm-fox-1234.trycloudflare.com' } },
    preBoot: (w) => {
      const orig = w.fetch;
      w.fetch = (url, init) => {
        if (init && init.method === 'DELETE') { deletes.push(url); return Promise.resolve({ ok: true }); }
        return orig(url, init);
      };
    },
  });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  document.querySelector('#sf-menu .sf-share-off').click();
  // The link is already out there and stopping the share breaks it for everyone
  // with no undo — publishing again mints a new token on a new URL.
  assert.equal(deletes.length, 0, 'nothing is revoked before the confirm');
  assert.ok(document.getElementById('sf-dc').hasAttribute('open'), 'a confirm dialog');
  assert.match(document.getElementById('sf-dc-body').textContent, /new link/,
    'it says the old link will not come back');
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  assert.ok(deletes.some((u) => /\/share$/.test(u)), 'confirming DELETEs the share');
});

test('Cancel on the unshare confirm leaves the link live', async (t) => {
  const deletes = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', share: { url: 'https://calm-fox-1234.trycloudflare.com' } },
    preBoot: (w) => {
      const orig = w.fetch;
      w.fetch = (url, init) => {
        if (init && init.method === 'DELETE') { deletes.push(url); return Promise.resolve({ ok: true }); }
        return orig(url, init);
      };
    },
  });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  document.querySelector('#sf-menu .sf-share-off').click();
  document.getElementById('sf-dc-cancel').click();
  await tick(window);
  assert.equal(deletes.length, 0, 'the link is untouched');
});

test('Copy puts the link on the clipboard', async (t) => {
  const copied = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', status: 'draft', share: { url: 'https://calm-fox-1234.trycloudflare.com' } },
    preBoot: (w) => {
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: (s) => { copied.push(s); return Promise.resolve(); } },
        configurable: true,
      });
    },
  });
  window.document.getElementById('sf-launcher').click();
  window.document.querySelector('#sf-menu .sf-share-copy').click();
  assert.deepEqual(copied, ['https://calm-fox-1234.trycloudflare.com'], 'the full URL, not the hostname');
});

test('a published copy is not offered the share row', async (t) => {
  const { window } = await bootReviewLayer(t, {
    transport: 'poll', seedStorage: { 'sf-author': 'Lavee' },
    meta: { id: 'test-spec', status: 'draft' },
  });
  window.document.getElementById('sf-launcher').click();
  assert.equal(rowByText(window.document, /Share this spec/), undefined);
  assert.equal(window.document.querySelector('#sf-menu .sf-share-on'), null);
});



const LIVE_SHARE = { url: 'https://calm-fox-1234.trycloudflare.com', live: true };
const DEAD_SHARE = { url: 'https://calm-fox-1234.trycloudflare.com', live: false };

test('no pill when nothing is shared', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { id: 'test-spec', title: 'T', status: 'draft' } });
  assert.equal(window.document.querySelector('.sf-tb-shared').hasAttribute('hidden'), true,
    'a pill saying "not shared" would be noise on every spec you own');
});

test('a working link reads as Shared and offers Copy', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', share: LIVE_SHARE },
  });
  const pill = window.document.querySelector('.sf-tb-shared');
  assert.equal(pill.hasAttribute('hidden'), false);
  assert.match(pill.textContent, /Shared/);
  assert.equal(pill.classList.contains('sf-tb-shared-down'), false);
  assert.match(pill.getAttribute('title'), /calm-fox-1234/, 'the URL is on the pill for a glance');
  assert.match(pill.querySelector('.sf-shared-act').textContent, /Copy/);
});

test('a dead link reads as a fault and offers Regenerate', async (t) => {
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', share: DEAD_SHARE },
  });
  const pill = window.document.querySelector('.sf-tb-shared');
  assert.match(pill.textContent, /Link down/);
  assert.equal(pill.classList.contains('sf-tb-shared-down'), true);
  assert.match(pill.querySelector('.sf-shared-act').textContent, /Regenerate/);
  assert.doesNotMatch(pill.textContent, /Copy/, 'copying a link that 502s helps nobody');
});

test('Copy on the pill copies the full URL', async (t) => {
  const copied = [];
  const { window } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', share: LIVE_SHARE },
    preBoot: (w) => {
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: (s) => { copied.push(s); return Promise.resolve(); } },
        configurable: true,
      });
    },
  });
  window.document.querySelector('.sf-tb-shared .sf-shared-act').click();
  assert.deepEqual(copied, ['https://calm-fox-1234.trycloudflare.com']);
});

test('Regenerate publishes again', async (t) => {
  const { window, posts } = await bootReviewLayer(t, {
    meta: { id: 'test-spec', title: 'T', status: 'draft', share: DEAD_SHARE },
  });
  window.document.querySelector('.sf-tb-shared .sf-shared-act').click();
  assert.ok(posts.some((p) => /\/share$/.test(p.url)), 'it posts a fresh share');
});

test('the pill reports work in flight while publishing', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { id: 'test-spec', title: 'T', status: 'draft' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  Array.prototype.find.call(document.querySelectorAll('#sf-menu .sf-menu-row'),
    (r) => /Share this spec/.test(r.textContent)).click();
  const pill = document.querySelector('.sf-tb-shared');
  assert.equal(pill.hasAttribute('hidden'), false, 'shown even though nothing is published yet');
  assert.match(pill.textContent, /Publishing…/);
});


// ---------- audience chips ----------
// Typing @agent on every comment is the tax these remove. The mention is still
// the only thing that routes a comment — the chips write it — so a chip and the
// text it produces can never disagree about where a comment is going.

/** The two chips of a composer card, by the order they are built in. */
function chipsOf(card) {
  const all = card.querySelectorAll('.sf-aud-chip');
  return { agent: all[0], human: all[1] };
}

/** Open the rail composer on the first block and hand back its card. */
async function composerOn(window, sel = 'p.a') {
  mouse(window, window.document.querySelector(sel), 'click');
  await new Promise((r) => window.setTimeout(r, 0));
  return window.document.querySelector('#sf-rail .sf-bub-compose');
}

const reviewer = { transport: 'poll', seedStorage: { 'sf-author': 'Lavee' } };

test('an owner composes for their agent by default, and the mention is written for them', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const card = await composerOn(window);
  const { agent, human } = chipsOf(card);
  assert.ok(agent, 'the composer carries the chips');
  assert.equal(agent.classList.contains('on'), true, 'the agent chip is the owner default');
  assert.equal(human.classList.contains('on'), false);
  assert.equal(agent.getAttribute('aria-pressed'), 'true', 'and says so to a screen reader');

  card.querySelector('textarea').value = 'tighten the goals section';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.equal(p.body.body, '@agent tighten the goals section',
    'the mention is prepended, so the comment routes without the owner typing it');
});

test('a reviewer composes discussion by default, and nothing is added to their text', async (t) => {
  // A reviewer on someone else's spec who submits work to that agent by accident
  // cannot undo it, so the safe side is the default here.
  const { window, posts } = await bootReviewLayer(t, reviewer);
  const card = await composerOn(window);
  const { agent, human } = chipsOf(card);
  assert.equal(human.classList.contains('on'), true, 'discussion is the reviewer default');
  assert.equal(agent.classList.contains('on'), false);

  card.querySelector('textarea').value = 'is this still true?';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.equal(p.body.body, 'is this still true?', 'sent verbatim — no mention, no agent');
});

test('a reviewer can still choose the agent, which is the whole point of the chip', async (t) => {
  const { window, posts } = await bootReviewLayer(t, reviewer);
  const card = await composerOn(window);
  chipsOf(card).agent.click();
  card.querySelector('textarea').value = 'please add a rollback plan';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.equal(p.body.body, '@agent please add a rollback plan');
});

test('choosing discussion removes a mention already typed', async (t) => {
  // Otherwise the chip reads "discussion" and the comment still reaches the
  // agent, because the text is what routes it.
  const { window, posts } = await bootReviewLayer(t);
  const card = await composerOn(window);
  const ta = card.querySelector('textarea');
  ta.value = '@agent why this order?';
  chipsOf(card).human.click();
  assert.equal(ta.value, 'why this order?', 'the mention is stripped out of the box');

  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.equal(p.body.body, 'why this order?');
});

test('typing the mention by hand raises the chip to match', async (t) => {
  const { window } = await bootReviewLayer(t, reviewer);
  const card = await composerOn(window);
  const ta = card.querySelector('textarea');
  const { agent, human } = chipsOf(card);
  assert.equal(human.classList.contains('on'), true, 'starts on discussion');

  ta.value = '@agent do this';
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(agent.classList.contains('on'), true, 'the chip follows the text up');
  assert.equal(human.classList.contains('on'), false);
});

test('typing ordinary text never lowers the chip', async (t) => {
  // The sync is one-way. Mirroring downward would clear the owner's @agent
  // default on their first keystroke, since writing the mention is the exact
  // work the chip exists to do for them.
  const { window, posts } = await bootReviewLayer(t);
  const card = await composerOn(window);
  const ta = card.querySelector('textarea');
  ta.value = 'tighten this paragraph';
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(chipsOf(card).agent.classList.contains('on'), true, 'still addressed to the agent');

  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(posts.find((x) => /\/comments$/.test(x.url)).body.body,
    '@agent tighten this paragraph');
});

test('a mention that is already there is not written twice', async (t) => {
  const { window, posts } = await bootReviewLayer(t);
  const card = await composerOn(window);
  card.querySelector('textarea').value = '@agent split stage 2';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments$/.test(x.url));
  assert.equal(p.body.body, '@agent split stage 2');
});

test('replying to a thread gets the same chips', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: twoOnOneBlock() });
  const { document } = window;
  document.querySelector('.sf-bub[data-tid="t1"]').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const card = document.querySelector('.sf-bub-open');
  assert.equal(chipsOf(card).agent.classList.contains('on'), true, 'owner default holds on a reply');
  card.querySelector('textarea').value = 'done, take another look';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments\/t1\/reply$/.test(x.url));
  assert.equal(p.body.body, '@agent done, take another look');
});

test('an empty comment stays empty rather than becoming a bare mention', async (t) => {
  // body() prepending onto nothing would post "@agent", which is a thread that
  // asks the agent for nothing at all.
  const { window, posts } = await bootReviewLayer(t);
  const card = await composerOn(window);
  card.querySelector('textarea').value = '   ';
  card.querySelector('.sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(posts.filter((x) => /\/comments$/.test(x.url)).length, 0, 'nothing was created');
});


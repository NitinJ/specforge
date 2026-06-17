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
async function bootReviewLayer(t) {
  const html = `<!doctype html><html><head></head><body>${SPEC_BODY}</body></html>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  // review.js installs a setInterval poll; close the window after the test so
  // the timer is cleared and the test runner can exit.
  t.after(() => window.close());
  window.SPECFORGE = { specId: 'test-spec' };
  const posts = [];
  window.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{"threads":[]}') });
    }
    return Promise.resolve({ text: () => Promise.resolve('{"threads":[]}') });
  };
  await new Promise((r) => window.setTimeout(r, 0));
  window.eval(REVIEW_JS); // deferred-script execution → boot() via the readyState check
  window.document.dispatchEvent(new window.Event('DOMContentLoaded')); // the DCL that follows
  await new Promise((r) => window.setTimeout(r, 0)); // flush load()/render microtasks
  return { window, posts };
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

test('the Theme row toggles data-theme on <html>', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const theme = rowByLabel(document, 'Theme');
  theme.click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'first toggle → dark (away from rendered light)');
  theme.click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light', 'second toggle → light');
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
  const compose = document.getElementById('sf-compose');
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
  assert.equal(document.getElementById('sf-compose'), null, 'no composer from a UI click');
});

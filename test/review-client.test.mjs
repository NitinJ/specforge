// Unit tests for the injected review-layer client (server/public/review.js),
// executed in a jsdom DOM. These cover the JS lifecycle + the block-level
// comment interaction: chrome builds once, hovering a block highlights it,
// clicking a block opens the composer and posts a block anchor. Layout (the
// review/theme toggle collision) needs a real browser and lives in the
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
  <button id="themeToggle" class="toggle">◐ theme</button>
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

test('review chrome is built exactly once (defer run + DOMContentLoaded)', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  assert.equal(document.querySelectorAll('#sf-toggle').length, 1, 'exactly one review toggle');
  assert.equal(document.querySelectorAll('#sf-sidebar').length, 1, 'exactly one sidebar');
  assert.equal(document.querySelectorAll('#sf-batchbar').length, 1, 'exactly one batch bar');
});

test('the single review toggle controls the single sidebar', async (t) => {
  const { window } = await bootReviewLayer(t);
  const { document } = window;
  const toggle = document.getElementById('sf-toggle');
  const sidebar = document.getElementById('sf-sidebar');
  toggle.click();
  assert.ok(sidebar.classList.contains('open'), 'toggle opens the sidebar');
  toggle.click();
  assert.ok(!sidebar.classList.contains('open'), 'toggle closes the sidebar');
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
  document.getElementById('sf-toggle').click();
  assert.equal(document.getElementById('sf-compose'), null, 'no composer from a UI click');
});

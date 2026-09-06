// The embed view: a spec page with the review chrome suppressed.
//
// A child spec is shown inside its parent in an iframe, so the page it loads
// must not carry a second launcher, a second comment rail or a second contents
// rail. What it must keep is everything that makes a spec readable: mermaid
// diagrams, highlighted code, zoom, and the interactive components.
//
// Two levels of assertion. The served response is checked for the flag and for
// the assets, and the booted DOM is checked for what was and was not built,
// because the chrome is created by review.js rather than sent as markup.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import { startDaemon } from './helpers/daemon-harness.mjs';
import { bootReviewLayer } from './helpers/review-dom.mjs';
import { injectReviewLayer } from '../server/inject.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-embed-');

let d;
afterEach(async () => { if (d) { await d.close(); d = null; } });

const DOC = '<!DOCTYPE html><html><head><title>T</title></head><body><h1>T</h1><p>Body.</p></body></html>';

// ── the served response ─────────────────────────────────────────────────────

test('the embed flag reaches the client config', async () => {
  const id = seedSpec({ title: 'Child' });
  d = await startDaemon();

  const plain = await (await d.get(`/spec/${id}`)).text();
  const embed = await (await d.get(`/spec/${id}?embed=1`)).text();

  assert.match(embed, /"embed":\s*true/);
  assert.doesNotMatch(plain, /"embed":\s*true/);
});

test('the embed view still carries the renderers a spec needs', async () => {
  const id = seedSpec({ title: 'Child' });
  d = await startDaemon();
  const html = await (await d.get(`/spec/${id}?embed=1`)).text();

  // The document is only readable if these still load. Suppressing the chrome
  // must not turn the page into plain text.
  assert.match(html, /review\.js/);
  assert.match(html, /zoom\.css/);
  assert.match(html, /"blocks":/, 'the component list the client anchors on');
  assert.match(html, /"live":/, 'the interactive-component selectors');
});

test('the embed view serves the spec body unchanged', async () => {
  const id = seedSpec({ title: 'Child' });
  d = await startDaemon();
  const html = await (await d.get(`/spec/${id}?embed=1`)).text();
  assert.match(html, /<h1>Child<\/h1>/);
});

test('a spec that does not exist is a 404 with or without the flag', async () => {
  d = await startDaemon();
  assert.equal((await d.get('/spec/0000000000?embed=1')).status, 404);
  assert.equal((await d.get('/spec/0000000000')).status, 404);
});

test('the theme can be handed to the frame so it paints right on first render', () => {
  const html = injectReviewLayer(DOC, { specId: 'abc1234567', embed: true, theme: 'dark' });
  assert.match(html, /"theme":\s*"dark"/);
});

test('an unknown theme is ignored rather than passed through', () => {
  const html = injectReviewLayer(DOC, { specId: 'abc1234567', embed: true, theme: 'neon' });
  assert.doesNotMatch(html, /"theme":\s*"neon"/);
});

// ── in-frame links ──────────────────────────────────────────────────────────

test('links in an embedded page open in a new tab, so a click cannot replace the frame', () => {
  const doc = '<html><head></head><body><a href="https://example.com">out</a>'
    + '<a href="#local">down</a></body></html>';
  const html = injectReviewLayer(doc, { specId: 'abc1234567', embed: true });

  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">/);
  // An anchor within the same document is navigation inside the frame, which is
  // the reader scrolling, not leaving.
  assert.match(html, /<a href="#local">down<\/a>/);
});

test('the same page without the flag is left alone', () => {
  const doc = '<html><head></head><body><a href="https://example.com">out</a></body></html>';
  const html = injectReviewLayer(doc, { specId: 'abc1234567' });
  assert.match(html, /<a href="https:\/\/example\.com">out<\/a>/);
});

test('an anchor that already names a target keeps it', () => {
  const doc = '<html><head></head><body><a href="https://x.test" target="_self">x</a></body></html>';
  const html = injectReviewLayer(doc, { specId: 'abc1234567', embed: true });
  assert.match(html, /target="_self"/);
  assert.doesNotMatch(html, /target="_self"[^>]*target="_blank"/);
});

// ── what the client builds, and does not ────────────────────────────────────

test('an embedded page builds no review chrome', async (t) => {
  const { window } = await bootReviewLayer(t, { embed: true });
  const gone = ['#sf-launcher', '#sf-menu', '#sf-sidebar', '#sf-rail', '#sf-ctx', '#sf-toc'];
  for (const sel of gone) {
    assert.equal(window.document.querySelector(sel), null, `${sel} was built in an embedded page`);
  }
});

test('the same page without the flag builds its chrome, so the test is not vacuous', async (t) => {
  const { window } = await bootReviewLayer(t, {});
  assert.ok(window.document.querySelector('#sf-launcher'), 'the launcher is missing without embed');
});

test('an embedded page still applies the theme', async (t) => {
  const { window } = await bootReviewLayer(t, { embed: true, prefs: { theme: 'light' } });
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
});

test('an embedded page writes nothing to the store', async (t) => {
  const { posts, puts, patches, dels } = await bootReviewLayer(t, { embed: true });
  // A read-only view that syncs its block registry would edit a spec the reader
  // is only looking at, and would do it from inside somebody else's page.
  assert.deepEqual(posts, []);
  assert.deepEqual(puts, []);
  assert.deepEqual(patches, []);
  assert.deepEqual(dels, []);
});

test('a right-click in an embedded page opens no context menu', async (t) => {
  const { window } = await bootReviewLayer(t, { embed: true });
  const p = window.document.querySelector('p');
  const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  p.dispatchEvent(ev);
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(window.document.querySelector('#sf-ctx'), null);
  assert.equal(ev.defaultPrevented, false, "the browser's own menu should be left alone");
});

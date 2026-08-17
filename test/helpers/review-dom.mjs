// Boot the injected review layer in a jsdom DOM, the way a browser does.
//
// Lifted out of review-client.test.mjs unchanged, because the context-menu
// stages need the same boot and a fifth private copy would mean one change to
// review.js has to be made in five test files. review-client.test.mjs owns the
// behaviour this helper reproduces; the other review test files keep their own
// narrower helpers, which stub a different global each (Prism, mermaid, the
// contribute API) and are not the same function wearing options.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
// The real registry, not a fixture: the menu the tests drive is the menu that
// ships, so a change to the action list has to be a deliberate change to the
// tests that assert its order.
import { menuActions } from '../../lib/actions/all.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REVIEW_JS = readFileSync(join(ROOT, 'server', 'public', 'review.js'), 'utf8');
// reconcile.js is injected before review.js and defines window.SFReconcile —
// the block registry the client resolves anchors against.
const RECONCILE_JS = readFileSync(join(ROOT, 'server', 'public', 'reconcile.js'), 'utf8');
// ui.js is injected ahead of both and defines window.SFUI — the snackbar and the
// confirm dialog, shared with the home page.
const UI_JS = readFileSync(join(ROOT, 'server', 'public', 'ui.js'), 'utf8');

/** The default fixture: no <section> wrappers, so block commenting is exercised
 * on a spec with no structure to fall back on. */
export const SPEC_BODY = `
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
 * A fixture with structure: three sections, the middle one carrying a list and a
 * table.
 *
 * The context-menu stages need both scopes present (a block, and the section it
 * sits in) and need blocks whose tags differ, because the menu offered on a table
 * cell is not the menu offered on a heading. Every block carries a class so a
 * test can name the one it means without counting.
 */
export const HARNESS_BODY = `
  <main>
    <h1>Harness Spec</h1>
    <section id="one" data-sf-section>
      <h2 class="h-one">1 · One</h2>
      <p class="p-one">A paragraph in the first section.</p>
    </section>
    <section id="two" data-sf-section>
      <h2 class="h-two">2 · Two</h2>
      <p class="p-two">A paragraph in the second section.</p>
      <ul><li class="li-two">A list item.</li></ul>
      <table>
        <thead><tr class="tr-head"><th class="th-two">Head</th></tr></thead>
        <tbody><tr class="tr-body"><td class="td-two">Cell</td></tr></tbody>
      </table>
    </section>
    <section id="three" data-sf-section>
      <h2 class="h-three">3 · Three</h2>
      <p class="p-three">A paragraph in the third section.</p>
    </section>
  </main>
  <div id="sf-live">● live</div>
`;

/**
 * Boot the review client the way a deferred <script> does: it runs after the
 * document is parsed (readyState !== 'loading'), THEN DOMContentLoaded fires.
 * Returns { window, posts, puts, patches, dels } — one bucket per write method,
 * each capturing { url, body } for the calls the client made.
 */
export async function bootReviewLayer(t, opts = {}) {
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
    // What the server injects for the context menu. Pass [] to boot a page that
    // was served before the feature existed, where no menu should open at all.
    actions: opts.actions === undefined ? menuActions() : opts.actions,
    // A published page sets this when its poll finds a newer spec. Settable at
    // boot so a test can exercise a stale page without driving the poll.
    ...(opts.stale ? { stale: true } : {}),
  };
  // jsdom defaults innerWidth to 1024 (below the TOC auto-collapse threshold);
  // let tests widen it so the floating TOC shows in auto mode.
  if (opts.innerWidth) Object.defineProperty(window, 'innerWidth', { value: opts.innerWidth, configurable: true });
  const posts = [];
  const puts = [];
  const patches = [];
  const dels = [];
  // DELETE is captured like the others. Without it a client DELETE fell through
  // to the read branch, whose response carries no `ok`, so code that checks
  // Response.ok saw undefined and reported a failure the server never sent.
  const BUCKETS = { POST: posts, PUT: puts, PATCH: patches, DELETE: dels };
  window.fetch = (url, init) => {
    const bucket = init && BUCKETS[init.method];
    if (bucket) {
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
  return { window, posts, puts, patches, dels };
}

/**
 * Boot with a stub SFReconcile that records the page it was handed.
 *
 * That argument is the client's own list of commentable blocks, as {tag, text} in
 * document order. Reading it is how a test learns which blocks the page thinks it
 * has without re-running BLOCK_SEL, which would only prove the test agrees with
 * itself.
 */
export async function bootWithBlockCapture(t, opts = {}) {
  const seen = [];
  const booted = await bootReviewLayer(t, {
    ...opts,
    noReconcile: true,
    preBoot: (window) => {
      window.SFReconcile = {
        reconcile: (page) => {
          seen.push(page);
          return {
            bids: page.map((_, i) => `b${i}`),
            changed: true,
            registry: { schema: 1, version: 2, seq: page.length, blocks: [], retired: [] },
          };
        },
      };
      if (opts.preBoot) opts.preBoot(window);
    },
  });
  return { ...booted, blocks: seen[0] || [], reconciled: seen };
}

/**
 * Right-click a block, by CSS selector.
 *
 * Throws rather than no-opping on a selector that matches nothing: a right-click
 * delivered nowhere leaves a test asserting that no menu opened, which is what it
 * would assert if the feature were broken.
 */
export function rightClick(window, selector, { x = 120, y = 240 } = {}) {
  const el = window.document.querySelector(selector);
  if (!el) throw new Error(`rightClick: no element matches ${selector}`);
  const event = new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
  });
  el.dispatchEvent(event);
  return { el, event };
}

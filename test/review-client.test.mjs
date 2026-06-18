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
  window.SPECFORGE = { specId: 'test-spec' };
  const posts = [];
  window.fetch = (url, init) => {
    if (init && init.method === 'POST') {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('{"ok":true}') });
    }
    if (String(url).indexOf('/meta') !== -1) {
      return Promise.resolve({ json: () => Promise.resolve(meta) });
    }
    return Promise.resolve({ text: () => Promise.resolve(threadsJson) });
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
  const btn = window.document.getElementById('sf-action');
  assert.ok(btn, 'action button present');
  assert.equal(btn.getAttribute('data-state'), 'needs');
  assert.match(btn.textContent, /Submit comments/);
  btn.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/submit$/.test(p.url)), 'clicking submits the batch');
});

test('action button: all comments resolved, not yet approved → "LGTM" and approves', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'lgtm');
  btn.click();
  await tick(window);
  const p = posts.find((x) => /\/status$/.test(x.url));
  assert.ok(p && p.body.status === 'approved', 'clicking LGTM POSTs status=approved');
});

test('action button: all resolved AND approved → "Implement →" and sets implementing', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: RESOLVED_THREAD, meta: { status: 'approved' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'impl');
  assert.match(btn.textContent, /Implement/);
  btn.click();
  await tick(window);
  const p = posts.find((x) => /\/status$/.test(x.url));
  assert.ok(p && p.body.status === 'implementing', 'clicking Implement POSTs status=implementing');
});

test('action button: an unsubmitted comment overrides approved status → "Submit comments"', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: PENDING_THREAD, meta: { status: 'approved' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'needs', 'open comment takes priority over approved');
  assert.match(btn.textContent, /Submit comments/);
});

test('action button: submitted but unresolved → "Awaiting response" (disabled, nothing to submit)', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'awaiting');
  assert.match(btn.textContent, /Awaiting/);
  assert.ok(btn.disabled, 'no submit action once the batch is already submitted');
});

test('action button: a submitted-but-open comment still blocks Implement on an approved doc', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: SUBMITTED_OPEN_THREAD, meta: { status: 'approved' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'awaiting', 'an unresolved comment overrides approved → not Implement');
});

test('action button: agent replied to every open thread → "Review replies", clicking opens the sidebar', async (t) => {
  const { window } = await bootReviewLayer(t, { threads: REPLIED_THREAD, meta: { status: 'in_review' } });
  const btn = window.document.getElementById('sf-action');
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
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'awaiting', 'still waiting while any open thread is unanswered');
});

test('action button: an unknown status is an inert display (no silent approve)', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'cancelled' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'other');
  assert.ok(btn.disabled, 'an unrecognized status carries no action');
});

test('action button: implementing is a disabled status display', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'implementing' } });
  const btn = window.document.getElementById('sf-action');
  assert.equal(btn.getAttribute('data-state'), 'working');
  assert.ok(btn.disabled, 'no action while implementing');
});

test('resolve-all shows when threads are open and posts resolve-all', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { threads: PENDING_THREAD });
  const btn = window.document.querySelector('.sf-resolve-all');
  assert.ok(btn.classList.contains('show'), 'shown with an open thread');
  btn.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/comments\/resolve-all$/.test(p.url)), 'posts resolve-all');
});

// ---------- launcher session row (attached + detach) ----------
test('menu shows the attached session + a Detach button that posts /detach', async (t) => {
  const { window, posts } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-12345678' } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Session sess-123');
  assert.ok(row, 'session row shows the attached session id');
  const detach = row.querySelector('.sf-detach');
  assert.ok(detach, 'Detach button present when attached');
  detach.click();
  await tick(window);
  assert.ok(posts.some((p) => /\/detach$/.test(p.url)), 'Detach posts /detach');
});

test('menu shows "Not attached" with no Detach button when free', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: null } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Not attached');
  assert.ok(row, 'session row shows Not attached');
  assert.equal(row.querySelector('.sf-detach'), null, 'no Detach button when free');
});

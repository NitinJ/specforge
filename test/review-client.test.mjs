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
  window.SPECFORGE = { specId: 'test-spec', prefs: opts.prefs || {} };
  const posts = [];
  const puts = [];
  const patches = [];
  window.fetch = (url, init) => {
    if (init && (init.method === 'POST' || init.method === 'PUT' || init.method === 'PATCH')) {
      const bucket = init.method === 'PUT' ? puts : init.method === 'PATCH' ? patches : posts;
      bucket.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('{"ok":true}') });
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

test('clicking an already-commented block opens a focused reply on that thread', async (t) => {
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
  assert.ok(document.getElementById('sf-sidebar').classList.contains('open'), 'the sidebar opens');
  const card = document.querySelector('.sf-thread[data-tid="t1"]');
  assert.ok(card, 'the thread card is present');
  const ta = card.querySelector('.sf-reply textarea');
  assert.ok(ta, 'a reply box opens on the thread so you can add another comment');

  ta.value = 'a second comment';
  card.querySelector('.sf-reply .sf-primary').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const p = posts.find((x) => /\/comments\/t1\/reply$/.test(x.url));
  assert.ok(p, 'sending posts to the thread reply endpoint');
  assert.equal(p.body.body, 'a second comment', 'the new comment lands on the same thread');
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

test('session row shows a live pill when connected, disconnected when not', async (t) => {
  const live = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-12345678', connected: true } });
  live.window.document.getElementById('sf-launcher').click();
  const onPill = live.window.document.querySelector('#sf-menu .sf-conn.on');
  assert.ok(onPill && /live/.test(onPill.textContent), 'connected → ● live');

  const off = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: 'sess-12345678', connected: false } });
  off.window.document.getElementById('sf-launcher').click();
  const offPill = off.window.document.querySelector('#sf-menu .sf-conn.off');
  assert.ok(offPill && /disconnected/.test(offPill.textContent), 'not connected → ● disconnected');
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
  assert.equal(groups.length, 3, 'Sans / Serif / Mono groups');
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

test('menu shows "Not attached" with no Detach button when free', async (t) => {
  const { window } = await bootReviewLayer(t, { meta: { status: 'draft', attachedSession: null } });
  const { document } = window;
  document.getElementById('sf-launcher').click();
  const row = rowByLabel(document, 'Not attached');
  assert.ok(row, 'session row shows Not attached');
  assert.equal(row.querySelector('.sf-detach'), null, 'no Detach button when free');
});

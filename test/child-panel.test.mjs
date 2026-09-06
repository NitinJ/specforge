// The child panel: a child spec shown inside its parent, read only.
//
// It holds an iframe rather than injected markup because every spec.html is a
// self-contained document with its own inline CSS, and two of them in one DOM
// collide with no general fix. That decision is what most of these tests are
// about: the frame's src is set on open and not before, its sandbox withholds
// top navigation, and closing clears the src so a closed panel holds no
// document.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer } from './helpers/review-dom.mjs';

const ROWS = [
  {
    id: 'aaa1111111', title: 'Code grounding', type: 'research', status: 'final',
    comments: { open: 0, total: 0 }, hasChildren: false,
  },
  {
    id: 'bbb2222222', title: 'Testing', type: 'test-plan', status: 'draft',
    comments: { open: 1, total: 1 }, hasChildren: true,
  },
];

async function openDrawer(window) {
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  rows.find((el) => /Child specs/.test(el.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
}

async function openChild(window, index = 0) {
  await openDrawer(window);
  window.document.querySelectorAll('#sf-children .sf-child-row')[index].click();
  await new Promise((r) => window.setTimeout(r, 0));
}

const panel = (window) => window.document.querySelector('#sf-child-panel');
const frame = (window) => window.document.querySelector('#sf-child-frame');

// ── on demand ───────────────────────────────────────────────────────────────

test('the panel exists but holds no document until a child is opened', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openDrawer(window);

  assert.ok(panel(window), 'the panel was not built');
  assert.equal(panel(window).classList.contains('open'), false);
  assert.equal(frame(window).getAttribute('src'), null, 'a closed panel is holding a document');
});

test('opening a child sets the frame src, once', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window, 0);

  assert.ok(panel(window).classList.contains('open'));
  const src = frame(window).getAttribute('src');
  assert.match(src, /^\/spec\/aaa1111111\?/);
  assert.match(src, /embed=1/, 'the child must be served with its chrome suppressed');
});

test('closing the panel clears the src, so nothing is held open behind it', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window, 0);
  window.document.querySelector('#sf-child-panel .sf-child-close').click();
  await new Promise((r) => window.setTimeout(r, 0));

  assert.equal(panel(window).classList.contains('open'), false);
  assert.equal(frame(window).getAttribute('src'), null);
});

// ── the boundary ────────────────────────────────────────────────────────────

test('the frame withholds top navigation, so a child cannot replace the parent', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window, 0);

  const sandbox = frame(window).getAttribute('sandbox');
  assert.ok(sandbox, 'the frame has no sandbox at all');
  // Scripts and same-origin are what make the child render: mermaid, prism and
  // the daemon's own assets. Top navigation is the one that must not be there.
  assert.match(sandbox, /allow-scripts/);
  assert.match(sandbox, /allow-same-origin/);
  assert.doesNotMatch(sandbox, /allow-top-navigation/);
});

test('the frame is told the parent theme so it paints right on the first render', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, prefs: { theme: 'light' } });
  await openChild(window, 0);
  assert.match(frame(window).getAttribute('src'), /theme=light/);
});

// ── descending ──────────────────────────────────────────────────────────────

test('the panel head names the child, and offers its own tab', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window, 0);

  const head = window.document.querySelector('#sf-child-panel .sf-child-head');
  assert.match(head.textContent, /Code grounding/);

  const tab = head.querySelector('.sf-child-newtab');
  assert.ok(tab, 'no way out to the full page, which is where commenting lives');
  assert.equal(tab.getAttribute('href'), '/spec/aaa1111111');
  assert.equal(tab.getAttribute('target'), '_blank');
});

test('a child with children of its own can be descended into', async (t) => {
  const { window } = await bootReviewLayer(t, {
    children: ROWS,
    childrenById: { bbb2222222: [{ id: 'ccc3333333', title: 'Deeper', type: 'general', status: 'draft', comments: { open: 0, total: 0 }, hasChildren: false }] },
  });
  await openChild(window, 1);

  const down = window.document.querySelector('#sf-child-panel .sf-child-down');
  assert.ok(down, 'a child with children offers no way down');
  down.click();
  await new Promise((r) => window.setTimeout(r, 0));

  const rows = window.document.querySelectorAll('#sf-children .sf-child-row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Deeper/);
});

test('the breadcrumb tracks the descent and can go back up', async (t) => {
  const { window } = await bootReviewLayer(t, {
    children: ROWS,
    childrenById: { bbb2222222: [{ id: 'ccc3333333', title: 'Deeper', type: 'general', status: 'draft', comments: { open: 0, total: 0 }, hasChildren: false }] },
  });
  await openChild(window, 1);
  window.document.querySelector('#sf-child-panel .sf-child-down').click();
  await new Promise((r) => window.setTimeout(r, 0));
  window.document.querySelectorAll('#sf-children .sf-child-row')[0].click();
  await new Promise((r) => window.setTimeout(r, 0));

  const crumbs = window.document.querySelectorAll('#sf-child-panel .sf-crumb');
  assert.equal(crumbs.length, 2, 'two levels down should be two crumbs');
  assert.match(crumbs[0].textContent, /Testing/);
  assert.match(crumbs[1].textContent, /Deeper/);

  crumbs[0].click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.match(frame(window).getAttribute('src'), /^\/spec\/bbb2222222\?/);
  assert.equal(window.document.querySelectorAll('#sf-child-panel .sf-crumb').length, 1);
});

// ── a child that went away ──────────────────────────────────────────────────

test('a child deleted since the drawer rendered shows a message, not a blank panel', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, childGone: true });
  await openChild(window, 0);

  const note = window.document.querySelector('#sf-child-panel .sf-child-missing');
  assert.ok(note, 'a 404 in the frame left nothing to explain it');
  assert.match(note.textContent, /no longer exists/i);
  assert.ok(note.querySelector('button'), 'no way to refresh after the message');
});

test('the parent page is untouched when a child is missing', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, childGone: true });
  await openChild(window, 0);
  assert.ok(window.document.querySelector('#sf-launcher'), 'the parent lost its chrome');
  assert.ok(window.document.querySelector('#sf-children'), 'the drawer was cleared');
});

// ── it stays read only ──────────────────────────────────────────────────────

test('opening a child writes nothing against that child', async (t) => {
  const { window, posts, puts, patches, dels } = await bootReviewLayer(t, { children: ROWS });
  await openChild(window, 0);

  // Scoped to the child, not to the page. The parent syncing its own block
  // registry on boot is a PUT and is correct; what must not happen is a write
  // against a spec the reader only opened a panel on.
  const forChild = [...posts, ...puts, ...patches, ...dels]
    .filter((call) => /aaa1111111/.test(String(call.url)));
  assert.deepEqual(forChild, []);
});

test('an embedded page builds no panel of its own', async (t) => {
  const { window } = await bootReviewLayer(t, { children: ROWS, embed: true });
  assert.equal(panel(window), null);
});

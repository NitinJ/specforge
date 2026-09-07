// The "Child specs" menu row, and the sidebar it opens.
//
// The row exists only when there is something behind it: a spec with no
// children would otherwise carry a menu entry that opens an empty drawer, and
// that is a worse answer than no entry.
//
// The sidebar reuses the comments drawer's mechanics, which is also where the
// one rule worth testing comes from: two drawers in the same gutter cannot both
// be open, or the second is drawn on top of the first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { bootReviewLayer } from './helpers/review-dom.mjs';

/** Boot with a children endpoint answering `rows`. */
function withChildren(t, rows, opts = {}) {
  return bootReviewLayer(t, {
    ...opts,
    children: rows,
  });
}

const ROWS = [
  {
    id: 'aaa1111111', title: 'Code grounding', type: 'code-exploration-spec', status: 'final',
    comments: { open: 0, total: 2 }, hasChildren: false,
  },
  {
    id: 'bbb2222222', title: 'Testing strategy', type: 'test-plan', status: 'draft',
    comments: { open: 3, total: 3 }, hasChildren: true,
  },
];

const menuLabels = (window) => Array.prototype.map.call(
  window.document.querySelectorAll('#sf-menu .sf-row-main'),
  (el) => el.textContent.trim(),
);

// ── the menu row ────────────────────────────────────────────────────────────

test('a spec with children carries a Child specs row', async (t) => {
  const { window } = await withChildren(t, ROWS);
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(menuLabels(window).some((l) => /Child specs/.test(l)));
});

test('a spec with no children carries no such row', async (t) => {
  const { window } = await withChildren(t, []);
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(menuLabels(window).some((l) => /Child specs/.test(l)), false);
});

test('the row sits below Comments, where the review controls are', async (t) => {
  const { window } = await withChildren(t, ROWS);
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const labels = menuLabels(window);
  const comments = labels.findIndex((l) => /Comments/.test(l));
  const children = labels.findIndex((l) => /Child specs/.test(l));
  assert.ok(comments >= 0 && children >= 0);
  assert.ok(children > comments, 'Child specs should follow Comments');
});

test('the row carries the child count', async (t) => {
  const { window } = await withChildren(t, ROWS);
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const row = menuLabels(window).find((l) => /Child specs/.test(l));
  assert.match(row, /2/);
});

// ── the sidebar ─────────────────────────────────────────────────────────────

async function openChildList(window) {
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  const row = rows.find((el) => /Child specs/.test(el.textContent));
  row.click();
  await new Promise((r) => window.setTimeout(r, 0));
}

test('clicking the row opens a drawer listing one row per child', async (t) => {
  const { window } = await withChildren(t, ROWS);
  await openChildList(window);

  const drawer = window.document.querySelector('#sf-children');
  assert.ok(drawer, 'the child drawer was not built');
  assert.ok(drawer.classList.contains('open'));
  assert.equal(drawer.querySelectorAll('.sf-child-row').length, 2);
});

test('each row shows the title, type and status', async (t) => {
  const { window } = await withChildren(t, ROWS);
  await openChildList(window);

  const first = window.document.querySelector('#sf-children .sf-child-row');
  assert.match(first.textContent, /Code grounding/);
  assert.match(first.textContent, /code-exploration-spec/);
  assert.match(first.textContent, /final/);
});

test('a row with open comments says so, and one without does not', async (t) => {
  const { window } = await withChildren(t, ROWS);
  await openChildList(window);

  const rows = window.document.querySelectorAll('#sf-children .sf-child-row');
  assert.equal(rows[0].querySelector('.sf-child-comments'), null, 'no badge with nothing open');
  assert.match(rows[1].querySelector('.sf-child-comments').textContent, /3/);
});

test('opening the child list closes the comments drawer', async (t) => {
  const { window } = await withChildren(t, ROWS);
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  rows.find((el) => /Comments/.test(el.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(window.document.querySelector('#sf-sidebar').classList.contains('open'));

  await openChildList(window);
  assert.equal(
    window.document.querySelector('#sf-sidebar').classList.contains('open'),
    false,
    'both drawers were open in the same gutter',
  );
});

test('opening the comments drawer closes the child list', async (t) => {
  const { window } = await withChildren(t, ROWS);
  await openChildList(window);

  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  rows.find((el) => /Comments/.test(el.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));

  assert.equal(window.document.querySelector('#sf-children').classList.contains('open'), false);
});

test('the drawer closes on its own close control', async (t) => {
  const { window } = await withChildren(t, ROWS);
  await openChildList(window);
  window.document.querySelector('#sf-children .sf-side-close').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(window.document.querySelector('#sf-children').classList.contains('open'), false);
});

test('the rows come from the children endpoint, and no child document is fetched', async (t) => {
  const { window, fetched } = await withChildren(t, ROWS);
  await openChildList(window);

  assert.ok(fetched.some((u) => /\/children$/.test(u)), 'the endpoint was never called');
  // The list is a list. Loading a child's document is what opening the panel
  // does, and that is stage 6.
  assert.equal(
    fetched.some((u) => /\/spec\/(aaa1111111|bbb2222222)/.test(u)),
    false,
    'a child document was fetched just to list it',
  );
});

test('an embedded page builds no child drawer either', async (t) => {
  const { window } = await withChildren(t, ROWS, { embed: true });
  assert.equal(window.document.querySelector('#sf-children'), null);
});

test('the drawer is offset beneath a fixed spec header, like the one it sits beside', () => {
  // Both drawers live in the same gutter, and the comments one has cleared the
  // header since it was written. Without the same rule the child drawer's own
  // title and its close control sat behind the bar, out of reach — the whole
  // drawer visible and neither control clickable.
  const css = readFileSync(new URL('../server/public/review.css', import.meta.url), 'utf8');
  const offset = (sel) => new RegExp('html\\[data-sf-header\\]\\s*' + sel + '\\s*\\{[^}]*top:\\s*var\\(--sf-header-h\\)');
  assert.match(css, offset('#sf-sidebar'), 'the comments drawer lost its offset, so this proves nothing');
  assert.match(css, offset('#sf-children'));
});

// ── the two share schemes ───────────────────────────────────────────────────
//
// A page served through a share is not at the store root, and it cannot be told
// where it is except by what the server injected. SPEC_ROOT is derived from the
// api base for exactly that reason, and it has to cover both schemes: /s/ for a
// spec and its subtree, /p/ for a project. The page's OWN api base is handed to
// it whole; it is every address for a spec other than itself that has to be
// built, and those are the ones that went to the wrong socket.

async function openDrawerAt(window) {
  window.document.querySelector('#sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const rows = Array.prototype.slice.call(window.document.querySelectorAll('#sf-menu .sf-menu-row'));
  rows.find((el) => /Child specs/.test(el.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
}

test('a project share opens a child under its own token', async (t) => {
  // A SPEC_ROOT regex that knew only /s/ left this empty, and every child link
  // and child request went to the gateway root, where nothing answers.
  const { window } = await withChildren(t, ROWS, {
    transport: 'poll', api: '/p/tok123/spec/test-spec/api',
  });
  await openDrawerAt(window);
  window.document.querySelectorAll('#sf-children .sf-child-row')[0].click();
  await new Promise((r) => window.setTimeout(r, 0));

  const src = window.document.querySelector('#sf-child-frame').getAttribute('src');
  assert.match(src, /^\/p\/tok123\/spec\/aaa1111111\?/);
  const tab = window.document.querySelector('#sf-child-panel .sf-child-newtab');
  assert.equal(tab.getAttribute('href'), '/p/tok123/spec/aaa1111111');
});

test('descending inside a project share stays inside it', async (t) => {
  const { window, fetched } = await withChildren(t, ROWS, {
    transport: 'poll',
    api: '/p/tok123/spec/test-spec/api',
    childrenById: { bbb2222222: [{ id: 'ccc3333333', title: 'Deeper', type: 'general', status: 'draft', comments: { open: 0, total: 0 }, hasChildren: false }] },
  });
  await openDrawerAt(window);
  window.document.querySelectorAll('#sf-children .sf-child-row')[1].click();
  await new Promise((r) => window.setTimeout(r, 0));
  window.document.querySelector('#sf-child-panel .sf-child-down').click();
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(
    fetched.some((u) => u === '/p/tok123/spec/bbb2222222/api/children'),
    `a child's own list was asked for off the share: ${fetched.join(', ')}`,
  );
});

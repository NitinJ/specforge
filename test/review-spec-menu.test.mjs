// The three spec-wide actions, on the page background.
//
// Consistency pass, Fix the naming and Canonicalize are meaningless on one
// block: a consistency pass needs both halves of a contradiction, and a rename
// applied to one section leaves the document saying two things. So they answer
// a right-click on the background, where nothing is pointed at, and they anchor
// to the title rather than to whatever the reader happened to be near.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §8, §9.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_BODY, bootReviewLayer, rightClick } from './helpers/review-dom.mjs';

const boot = (t, opts = {}) => bootReviewLayer(t, { body: HARNESS_BODY, ...opts });
const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

const menu = (window) => window.document.getElementById('sf-ctx');
const isOpen = (window) => !!menu(window) && menu(window).classList.contains('open');
const labels = (window) => [...menu(window).querySelectorAll('.sf-menu-row')]
  .map((r) => r.textContent.replace(/\s+/g, ' ').trim());
const rowByLabel = (window, label) => [...menu(window).querySelectorAll('.sf-menu-row')]
  .find((r) => r.textContent.includes(label));

/** Right-click the page background: nothing commentable under the pointer. */
function rightClickBackground(window, { x = 40, y = 300 } = {}) {
  const event = new window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
  });
  window.document.body.dispatchEvent(event);
  return event;
}

test('right-clicking the background opens a menu of the spec-wide actions only', async (t) => {
  const { window } = await boot(t);
  const event = rightClickBackground(window);
  assert.ok(isOpen(window), 'the menu opened');
  assert.ok(event.defaultPrevented, 'and the browser menu was suppressed');
  assert.equal(
    labels(window).join(' | '),
    '🏷Fix the naming | ⇄Consistency pass | 📜Canonicalize',
  );
});

test('nothing block-scoped appears there, rather than appearing disabled', async (t) => {
  // No block is selected, so a greyed-out Tighten would be a row explaining an
  // absence. The absence explains itself.
  const { window } = await boot(t);
  rightClickBackground(window);
  for (const gone of ['Tighten', 'Visualize', 'Copy link', 'Import']) {
    assert.equal(rowByLabel(window, gone), undefined, `${gone} is not spec-wide`);
  }
});

test('a spec-wide action anchors to the title, not to where the pointer was', async (t) => {
  const { window } = await boot(t);
  rightClickBackground(window);
  rowByLabel(window, 'Consistency pass').click();
  await tick(window);

  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'the composer opened');
  assert.equal(card.querySelector('textarea').value, '@consistency_pass ');
  assert.match(card.querySelector('.q').textContent, /Harness Spec/,
    'anchored to the h1: the scope is the document, so the anchor says so');
});

test('sending it produces the comment the agent reads', async (t) => {
  const { window, posts } = await boot(t);
  rightClickBackground(window);
  rowByLabel(window, 'Fix the naming').click();
  await tick(window);
  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  const ta = card.querySelector('textarea');
  // fix_the_naming carries needsDetail: without both terms the agent has to ask.
  ta.value = `${ta.value}call it a garment, not a product`;
  card.querySelector('.sf-primary').click();
  await tick(window);

  const posted = posts.find((p) => /\/comments$/.test(p.url));
  assert.equal(posted.body.body, '@agent @fix_the_naming call it a garment, not a product');
});

test('a block still gets the block menu, not the spec one', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two');
  assert.equal(rowByLabel(window, 'Consistency pass'), undefined, 'scope comes from what you hit');
  assert.ok(rowByLabel(window, 'Tighten'));
});

test('the two menus are the same menu, re-aimed', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two');
  rightClickBackground(window);
  assert.equal(window.document.querySelectorAll('#sf-ctx').length, 1);
  assert.equal(labels(window).length, 3, 'and it is showing the spec-wide list now');
});

test('right-clicking the review chrome still opens nothing', async (t) => {
  // The background menu must not turn every miss into a menu. The launcher is
  // chrome, and a spec-wide action offered over it is nonsense.
  const { window } = await boot(t);
  const launcher = window.document.getElementById('sf-launcher');
  const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  launcher.dispatchEvent(ev);
  assert.equal(isOpen(window), false);
  assert.equal(ev.defaultPrevented, false);
});

test('a page served before the feature existed opens no background menu either', async (t) => {
  const { window } = await boot(t, { actions: [] });
  const ev = rightClickBackground(window);
  assert.equal(isOpen(window), false);
  assert.equal(ev.defaultPrevented, false, 'the browser menu is left working');
});

test('a spec with no title falls back to the first block rather than failing', async (t) => {
  // Every spec the tool makes has an h1, but an imported one might not, and a
  // menu that throws on right-click is worse than one anchored a line off.
  const { window } = await boot(t, { body: HARNESS_BODY.replace(/<h1>.*?<\/h1>/, '') });
  rightClickBackground(window);
  rowByLabel(window, 'Canonicalize').click();
  await tick(window);
  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'it still opened a composer');
  assert.equal(card.querySelector('textarea').value, '@canonicalize ');
});

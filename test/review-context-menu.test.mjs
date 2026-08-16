// The context menu: right-click a block, pick an action, get a comment.
//
// The whole feature is a comment. Picking Visualize does not call an agent, does
// not queue a job and does not write the spec: it opens the composer already
// holding `@visualize`, and the audience chip that was already there prepends
// `@agent` when you send it. So what these tests assert is that the menu ends in
// the composer, and that the composer still behaves like a composer.
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

test('right-clicking a block opens the menu and suppresses the native one', async (t) => {
  const { window } = await boot(t);
  const { event } = rightClick(window, 'p.p-two');
  assert.ok(isOpen(window), 'the menu opened');
  assert.ok(event.defaultPrevented, 'the browser menu was suppressed, or you get two menus');
});

test('the menu lists the local actions, in registry order', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two');
  assert.equal(
    labels(window).join(' | '),
    '💡Explain simply | ⊞Visualize | 🔎Go deeper | ✓Verify against code | ⚖Help me decide'
      + ' | ❝Show an example | ☰Restructure | ✂Tighten | 🔗Copy link',
  );
});

test('the menu carries no global action, because no block was pointed at the whole spec', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two');
  for (const gone of ['Fix the naming', 'Consistency pass', 'Canonicalize']) {
    assert.equal(rowByLabel(window, gone), undefined, `${gone} is spec-wide`);
  }
});

test('the menu opens at the pointer', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two', { x: 300, y: 410 });
  assert.equal(menu(window).style.left, '300px');
  assert.equal(menu(window).style.top, '410px');
});

test('Escape, a click away, and a scroll each close it', async (t) => {
  const { window } = await boot(t);
  const { document } = window;

  rightClick(window, 'p.p-two');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(isOpen(window), false, 'Escape closes');

  rightClick(window, 'p.p-two');
  document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(isOpen(window), false, 'a click away closes');

  rightClick(window, 'p.p-two');
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(isOpen(window), false, 'a scroll closes, because the menu would be left behind');
});

test('right-clicking a second block re-aims the menu rather than opening another', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-one', { x: 10, y: 20 });
  rightClick(window, 'p.p-three', { x: 90, y: 200 });
  assert.equal(window.document.querySelectorAll('#sf-ctx').length, 1, 'one menu, ever');
  assert.equal(menu(window).style.left, '90px');
  assert.ok(isOpen(window));
});

test('picking an action opens the composer on that block, holding the action', async (t) => {
  const { window } = await boot(t);
  rightClick(window, 'p.p-two');
  rowByLabel(window, 'Visualize').click();
  await tick(window);

  assert.equal(isOpen(window), false, 'the menu closes when you pick something');
  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'the composer opened');
  assert.equal(card.querySelector('textarea').value, '@visualize ',
    'seeded with the action and a trailing space, so a qualifier can be typed straight on');
  assert.match(card.querySelector('.q').textContent, /second section/,
    'anchored to the block that was right-clicked');
});

test('sending it produces the comment the agent reads', async (t) => {
  const { window, posts } = await boot(t);
  rightClick(window, 'p.p-two');
  rowByLabel(window, 'Go deeper').click();
  await tick(window);

  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  const ta = card.querySelector('textarea');
  // The composer is a text box, which is the whole reason an action can carry a
  // qualifier without anything being designed for it (D7).
  ta.value = `${ta.value}on the retry path`;
  card.querySelector('.sf-primary').click();
  await tick(window);

  const posted = posts.find((p) => /\/comments$/.test(p.url));
  assert.equal(posted.body.body, '@agent @go_deeper on the retry path',
    'the audience chip prepends @agent; the menu only ever wrote the action');
});

test('Copy link writes the anchor and opens no composer', async (t) => {
  const written = [];
  const { window } = await boot(t, {
    preBoot: (w) => {
      Object.defineProperty(w.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (s) => { written.push(s); return Promise.resolve(); } },
      });
    },
  });
  rightClick(window, 'p.p-two');
  rowByLabel(window, 'Copy link').click();
  await tick(window);

  assert.deepEqual(written, ['http://localhost/#two'], 'the section anchor, not the block');
  assert.equal(window.document.querySelector('#sf-rail .sf-bub-compose'), null,
    'a direct action never reaches the agent, so there is nothing to compose');
});

test('right-clicking away from any block leaves the native menu alone', async (t) => {
  // The page background is stage 5. Until then a right-click there has to do
  // nothing rather than open an empty menu.
  const { window } = await boot(t);
  const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  window.document.body.dispatchEvent(ev);
  assert.equal(isOpen(window), false);
  assert.equal(ev.defaultPrevented, false);
});

test('a page served before the feature existed has no menu at all', async (t) => {
  const { window } = await boot(t, { actions: [] });
  const ev = rightClick(window, 'p.p-two').event;
  assert.equal(isOpen(window), false, 'nothing to show, so nothing opens');
  assert.equal(ev.defaultPrevented, false, 'and the browser menu is left working');
});

test('right-clicking inside the review chrome leaves it alone', async (t) => {
  // The launcher and the rail are not the document, and a menu of "explain this
  // simply" over the SpecForge button is nonsense.
  const { window } = await boot(t);
  const launcher = window.document.getElementById('sf-launcher');
  const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  launcher.dispatchEvent(ev);
  assert.equal(isOpen(window), false);
  assert.equal(ev.defaultPrevented, false);
});

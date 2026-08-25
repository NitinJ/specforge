// The harness switcher in the spec header.
//
// It replaces the Connected chip when more than one agent is connected, and it
// is the only place the active harness is chosen. That is what makes E8 true:
// nothing an agent does can take work from another, or strand a spec by crashing
// while it holds it.
//
// Spec e9ddcddef6, tasks 6.5 and 6.6.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer } from './helpers/review-dom.mjs';

/** Meta as the server sends it for a spec with these connections. */
const withHarnesses = (harnesses, over = {}) => ({
  meta: {
    attachedSession: 'claude:c1',
    sessionLabel: 'claude session c1',
    connected: true,
    harnesses,
    activeHarness: (harnesses.find((h) => h.active) || {}).harness || null,
  },
  ...over,
});

const ONE = [{ harness: 'claude', session: 'claude:c1', active: true, alive: true }];
const BOTH = [
  { harness: 'claude', session: 'claude:c1', active: true, alive: true },
  { harness: 'pi', session: 'pi:p1', active: false, alive: true },
];
const PI_ASLEEP = [
  { harness: 'claude', session: 'claude:c1', active: true, alive: true },
  { harness: 'pi', session: 'pi:p1', active: false, alive: false },
];

const buttons = (window) =>
  [...window.document.querySelectorAll('.sf-harness-b')].map((b) => ({
    harness: b.getAttribute('data-harness'),
    on: b.classList.contains('sf-harness-on'),
    dead: b.classList.contains('sf-harness-dead'),
    pressed: b.getAttribute('aria-pressed'),
  }));

const settle = (window) => new Promise((r) => window.setTimeout(r, 0));

test('one connected agent renders the chip, unchanged', async (t) => {
  // Every spec in the store is this case. It must read exactly as it always did.
  const { window } = await bootReviewLayer(t, withHarnesses(ONE));
  assert.equal(window.document.querySelectorAll('.sf-harness-b').length, 0);
  assert.equal(window.document.querySelector('.sf-conn-label').textContent, 'Connected');
});

test('two connected agents render a button each, the active one marked', async (t) => {
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH));
  assert.deepEqual(buttons(window), [
    { harness: 'claude', on: true, dead: false, pressed: 'true' },
    { harness: 'pi', on: false, dead: false, pressed: 'false' },
  ]);
});

test('the chip label gives way to the switcher', async (t) => {
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH));
  assert.equal(window.document.querySelector('.sf-conn-label'), null);
  assert.match(window.document.querySelector('.sf-tb-conn').title, /highlighted one receives/);
});

test('a connection that is not listening is marked, and still selectable', async (t) => {
  // Refusing would leave a spec with no possible recipient the moment its one
  // live agent went quiet.
  const { window } = await bootReviewLayer(t, withHarnesses(PI_ASLEEP));
  const pi = buttons(window).find((b) => b.harness === 'pi');
  assert.equal(pi.dead, true);
  assert.equal(window.document.querySelector('[data-harness="pi"]').disabled, false);
  assert.match(window.document.querySelector('[data-harness="pi"]').title, /reconnect/);
});

test('picking one posts the choice to the server', async (t) => {
  const { window, posts } = await bootReviewLayer(t, withHarnesses(BOTH));
  window.document.querySelector('[data-harness="pi"]').click();
  await settle(window);

  const sent = posts.find((p) => String(p.url).indexOf('/active') !== -1);
  assert.ok(sent, 'no /active post in ' + JSON.stringify(posts.map((p) => p.url)));
  assert.deepEqual(sent.body, { harness: 'pi' });
});

test('the active one is not a button that posts anything', async (t) => {
  // Clicking the agent already working the spec would be a request that changes
  // nothing, and a flash saying so.
  const { window, posts } = await bootReviewLayer(t, withHarnesses(BOTH));
  window.document.querySelector('[data-harness="claude"]').click();
  await settle(window);
  assert.equal(posts.filter((p) => String(p.url).indexOf('/active') !== -1).length, 0);
});

test('a refused switch leaves the switcher as it was', async (t) => {
  // The harness can disconnect between the render and the click. The answer is
  // a 409, and the page must not draw a state the store does not hold.
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH, { failPost: /\/active/ }));
  window.document.querySelector('[data-harness="pi"]').click();
  await settle(window);
  await settle(window);
  assert.deepEqual(buttons(window).map((b) => b.on), [true, false], 'claude still holds it');
});

test('a published copy shows no switcher at all', async (t) => {
  // A reviewer holding a link has no agent of their own to hand the spec to.
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH, {
    transport: 'poll',
    url: 'http://localhost/s/abc123',
  }));
  assert.equal(window.document.querySelectorAll('.sf-harness-b').length, 0);
  assert.equal(window.document.querySelector('.sf-tb-conn').hasAttribute('hidden'), true);
});

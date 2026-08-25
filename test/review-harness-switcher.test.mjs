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

const options = (window) =>
  [...window.document.querySelectorAll('.sf-harness option')].map((o) => ({
    harness: o.getAttribute('data-harness'),
    label: o.textContent,
    selected: o.selected,
  }));

const picker = (window) => window.document.querySelector('select.sf-harness');

/** Choose an option the way a person does: set it, then fire change. */
function choose(window, harness) {
  const sel = picker(window);
  sel.value = harness;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
}

const settle = (window) => new Promise((r) => window.setTimeout(r, 0));

test('one connected agent renders the chip, unchanged', async (t) => {
  // Every spec in the store is this case. It must read exactly as it always did.
  const { window } = await bootReviewLayer(t, withHarnesses(ONE));
  assert.equal(picker(window), null);
  assert.equal(window.document.querySelector('.sf-conn-label').textContent, 'Connected');
});

test('two connected agents render one dropdown, the active one selected', async (t) => {
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH));
  assert.equal(picker(window).tagName, 'SELECT');
  assert.deepEqual(options(window), [
    { harness: 'claude', label: 'claude', selected: true },
    { harness: 'pi', label: 'pi', selected: false },
  ]);
  assert.equal(picker(window).value, 'claude');
});

test('the chip label gives way to the switcher', async (t) => {
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH));
  assert.equal(window.document.querySelector('.sf-conn-label'), null);
  assert.match(window.document.querySelector('.sf-tb-conn').title, /highlighted one receives/);
});

test('an agent that is not listening says so in its label, not only its title', async (t) => {
  // An option's title never shows while the select is closed, so a dead agent
  // would look ordinary until the list was opened.
  const { window } = await bootReviewLayer(t, withHarnesses(PI_ASLEEP));
  const pi = options(window).find((o) => o.harness === 'pi');
  assert.match(pi.label, /needs reconnect/);
  assert.equal(picker(window).disabled, false, 'and it is still choosable');
});

test('choosing one posts the choice to the server', async (t) => {
  const { window, posts } = await bootReviewLayer(t, withHarnesses(BOTH));
  choose(window, 'pi');
  await settle(window);

  const sent = posts.find((p) => String(p.url).indexOf('/active') !== -1);
  assert.ok(sent, 'no /active post in ' + JSON.stringify(posts.map((p) => p.url)));
  assert.deepEqual(sent.body, { harness: 'pi' });
});

test('a select that does not change posts nothing', async (t) => {
  // Opening the list and picking the agent already working the spec fires no
  // change event, so there is nothing to guard against here beyond not posting
  // on render.
  const { window, posts } = await bootReviewLayer(t, withHarnesses(BOTH));
  await settle(window);
  assert.equal(posts.filter((p) => String(p.url).indexOf('/active') !== -1).length, 0);
});

test('a refused switch redraws the switcher as the store holds it', async (t) => {
  // The agent can disconnect between the render and the choice. The answer is a
  // 409, and the page must not be left showing a selection nothing accepted.
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH, { failPost: /\/active/ }));
  choose(window, 'pi');
  await settle(window);
  await settle(window);
  assert.equal(picker(window).value, 'claude', 'claude still holds it');
});

test('the dot follows the chosen agent, not the server’s connected flag', async (t) => {
  // The flag is computed for the active session and is not re-sent when a switch
  // answers, so trusting it left the dot green after switching to an agent that
  // is not listening.
  const { window } = await bootReviewLayer(t, withHarnesses([
    { harness: 'claude', session: 'claude:c1', active: false, alive: true },
    { harness: 'pi', session: 'pi:p1', active: true, alive: false },
  ]));
  assert.ok(
    window.document.querySelector('.sf-tb-conn').classList.contains('sf-tb-conn-off'),
    'pi holds the spec and is not listening, so the dot must not read live',
  );
});

test('a published copy shows no switcher at all', async (t) => {
  // A reviewer holding a link has no agent of their own to hand the spec to.
  const { window } = await bootReviewLayer(t, withHarnesses(BOTH, {
    transport: 'poll',
    url: 'http://localhost/s/abc123',
  }));
  assert.equal(picker(window), null);
  assert.equal(window.document.querySelector('.sf-tb-conn').hasAttribute('hidden'), true);
});

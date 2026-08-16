// The shared jsdom harness the context-menu stages test against.
//
// Every later stage of the context-menu feature needs the same three things: the
// review layer booted over a spec whose sections are known, the page's own list
// of commentable blocks, and a right-click delivered at a chosen block. Four
// review test files have each grown a private boot function already; a fifth copy
// is the point at which one change to review.js has to be made in five places.
//
// The block list is read from what the client hands SFReconcile rather than by
// re-running BLOCK_SEL here. A test that reimplements the selector agrees with
// itself and not with the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HARNESS_BODY, bootReviewLayer, bootWithBlockCapture, rightClick,
} from './helpers/review-dom.mjs';

test('the harness boots the review layer over the fixture', async (t) => {
  const { window } = await bootReviewLayer(t, { body: HARNESS_BODY });
  const { document } = window;
  assert.equal(document.querySelectorAll('#sf-launcher').length, 1, 'the launcher built');
  assert.equal(document.querySelectorAll('#sf-sidebar').length, 1, 'the sidebar built');
});

test('the fixture carries three sections, one of them holding a list and a table', async (t) => {
  const { window } = await bootReviewLayer(t, { body: HARNESS_BODY });
  const ids = [...window.document.querySelectorAll('section[id]')].map((s) => s.id);
  assert.deepEqual(ids, ['one', 'two', 'three'], 'three sections, in order, with stable ids');
  const two = window.document.getElementById('two');
  assert.ok(two.querySelector('ul li'), 'section two carries a list');
  assert.ok(two.querySelector('table td'), 'section two carries a table');
});

test('the page reports every fixture block and none of the review chrome', async (t) => {
  const { blocks } = await bootWithBlockCapture(t, { body: HARNESS_BODY });
  // Joined rather than deepStrictEqual'd against an array: `blocks` was built
  // inside the jsdom realm, so its prototype is that realm's Array and a strict
  // deep-equal fails on the prototype while printing two identical-looking lists.
  assert.equal(
    blocks.map((b) => b.tag).join(' '),
    'H1 H2 P H2 P LI TR TH TR TD H2 P',
    'document order, and nothing the review layer injected',
  );
  assert.equal(blocks[2].text, 'A paragraph in the first section.');
});

test('rightClick delivers a contextmenu event at the chosen block', async (t) => {
  const { window } = await bootReviewLayer(t, { body: HARNESS_BODY });
  const seen = [];
  window.document.addEventListener('contextmenu', (e) => seen.push(e));
  const { el } = rightClick(window, 'p.p-two');
  assert.equal(seen.length, 1, 'exactly one event, and it bubbled to the document');
  assert.equal(seen[0].target, el, 'targeted at the block that was asked for');
  assert.equal(seen[0].button, 2, 'the right button, so a handler keying off it fires');
  assert.ok(seen[0].cancelable, 'cancelable, so a handler can suppress the native menu');
});

test('rightClick names the selector when nothing matches', async (t) => {
  const { window } = await bootReviewLayer(t, { body: HARNESS_BODY });
  assert.throws(() => rightClick(window, 'p.nope'), /p\.nope/);
});

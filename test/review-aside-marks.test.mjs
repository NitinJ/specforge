// Where the aside marker goes, and what the panel shows.
//
// Two corrections. The marker belongs on the block that was commented, not on
// the section containing it: an action is asked for on a paragraph, and a marker
// at the top of a twelve-paragraph section says nothing about which one. And the
// panel shows one aside at a time, at half the page or more, because a draft is
// read rather than skimmed.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootReviewLayer } from './helpers/review-dom.mjs';

const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

const BODY = `
  <main>
    <h1>Aside Spec</h1>
    <section id="two" data-sf-section>
      <h2 class="h-two">2 · Two</h2>
      <p class="p-a">The first paragraph.</p>
      <p class="p-b">The second paragraph, which the action was asked for on.</p>
      <p class="p-c">The third paragraph.</p>
    </section>
    <section id="two-aside-1" data-sf-aside="two" data-sf-block="b3" data-sf-action="visualize">
      <p class="aside-p">A diagram the agent drafted.</p>
    </section>
    <section id="three" data-sf-section><h2>3 · Three</h2><p>Third section.</p></section>
  </main>
  <div id="sf-live">● live</div>
`;

// The page's own block list, in document order, is what a bid indexes into:
// h1, h2, p.p-a, p.p-b, p.p-c, p.aside-p, h2, p → b0 … b7. So b3 is p.b.
// A draft carries no heading of its own: its label comes from data-sf-action.
const boot = (t, opts = {}) => bootReviewLayer(t, { body: BODY, ...opts });
const marks = (window) => [...window.document.querySelectorAll('.sf-aside-mark')];

test('the marker attaches to the block that was commented', async (t) => {
  const { window } = await boot(t);
  await tick(window);
  const all = marks(window);
  assert.equal(all.length, 1, 'one marker, for one aside');
  assert.equal(all[0].getAttribute('data-sf-for'), 'two-aside-1');
  assert.equal(
    Number(all[0].style.top.replace('px', '')) >= 0, true,
    'positioned against its block rather than pinned to the section heading',
  );
});

test('the marker is placed across the page as well as down it', async (t) => {
  // It used to hang off the section's own right edge, which put it against the
  // text. Both coordinates are measured now, so both are set inline; the gutter
  // it lands in is a geometry question and lives in the browser tests.
  const { window } = await boot(t);
  await tick(window);
  assert.notEqual(marks(window)[0].style.left, '', 'a measured horizontal position');
});

test('a marker is found by its aside, not by a selector built from the id', async (t) => {
  // Section ids are author-written. One holding a quote or a bracket makes an
  // attribute selector built by concatenation either throw or match the wrong
  // element, and the marker is then created a second time on every reflow.
  const { window } = await boot(t, {
    body: BODY.replace(/two-aside-1/g, 'two"a-aside-1').replace('id="two"', 'id="two"'),
  });
  await tick(window);
  window.dispatchEvent(new window.Event('resize'));
  await tick(window);
  assert.equal(marks(window).length, 1, 'still one marker after a re-place');
});

test('the marker is still not inside any block', async (t) => {
  // A comment anchors to a block's normalized text, so chrome inside one would
  // rewrite that text and orphan every thread already on it. This holds whether
  // the marker is aimed at a block or at a section.
  const { window } = await boot(t);
  await tick(window);
  assert.equal(marks(window)[0].closest('p, h2, h3, li, td, th'), null);
  assert.equal(
    window.document.querySelector('.p-b').textContent.trim(),
    'The second paragraph, which the action was asked for on.',
  );
});

test('an aside naming no block falls back to its section', async (t) => {
  // Written before --block existed, or written when the registry was
  // unavailable. It still has to be reachable.
  const { window } = await boot(t, { body: BODY.replace(' data-sf-block="b3"', '') });
  await tick(window);
  assert.equal(marks(window).length, 1, 'still one marker');
  assert.equal(marks(window)[0].getAttribute('data-sf-for'), 'two-aside-1');
});

test('an aside naming a block that no longer exists falls back too', async (t) => {
  const { window } = await boot(t, { body: BODY.replace('data-sf-block="b3"', 'data-sf-block="b99"') });
  await tick(window);
  assert.equal(marks(window).length, 1);
});

test('two asides on one section get a marker each, not one shared', async (t) => {
  // The old marker stacked every icon into one chip on the section, so two
  // drafts on two different paragraphs were one button that opened whichever
  // came first.
  const { window } = await boot(t, {
    body: BODY.replace(
      '<section id="three"',
      '<section id="two-aside-2" data-sf-aside="two" data-sf-block="b4" data-sf-action="go_deeper">'
      + '<h3>Aside: Go deeper</h3><p>More.</p></section><section id="three"',
    ),
  });
  await tick(window);
  const all = marks(window);
  assert.equal(all.length, 2);
  assert.deepEqual(
    all.map((m) => m.getAttribute('data-sf-for')).sort(),
    ['two-aside-1', 'two-aside-2'],
  );
});

test('the panel shows only the aside whose marker was clicked', async (t) => {
  const { window } = await boot(t, {
    body: BODY.replace(
      '<section id="three"',
      '<section id="two-aside-2" data-sf-aside="two" data-sf-block="b4" data-sf-action="go_deeper">'
      + '<h3>Aside: Go deeper</h3><p class="aside-p2">More.</p></section><section id="three"',
    ),
  });
  await tick(window);
  const markFor = (id) => marks(window).find((m) => m.getAttribute('data-sf-for') === id);

  markFor('two-aside-2').click();
  await tick(window);
  const shown = () => [...window.document.querySelectorAll('#sf-asides section[data-sf-aside]')]
    .filter((s) => !s.hasAttribute('hidden')).map((s) => s.id);
  assert.deepEqual(shown(), ['two-aside-2'], 'one at a time, and it is the one asked for');

  markFor('two-aside-1').click();
  await tick(window);
  assert.deepEqual(shown(), ['two-aside-1'], 'clicking the other marker swaps it');
});

test('the panel names the action it is showing', async (t) => {
  const { window } = await boot(t);
  await tick(window);
  marks(window)[0].click();
  await tick(window);
  assert.match(
    window.document.querySelector('#sf-asides .sf-asides-head').textContent,
    /Visualize/,
    'the heading says which draft, since only one is on screen',
  );
});

test('the aside is still commentable, and the rail still returns to compose', async (t) => {
  const { window } = await boot(t, { innerWidth: 1600 });
  await tick(window);
  marks(window)[0].click();
  await tick(window);
  window.document.querySelector('.aside-p').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  assert.ok(window.document.querySelector('#sf-rail .sf-bub-compose'));
});

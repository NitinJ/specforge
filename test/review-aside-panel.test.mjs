// Asides render in a panel, not in the flow.
//
// The model and the rendering are separate decisions. In the file an aside is a
// section sitting after its source, which is what makes export, anchoring,
// comments and the gate work with no code written for them. On screen it is
// lifted into a right-hand panel, because a draft you have not accepted should
// not push the document you are reading down the page.
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
      <p class="p-two">A paragraph in the second section.</p>
    </section>
    <section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize">
      <h3 class="aside-h">Aside: Visualize</h3>
      <p class="aside-p">A diagram the agent drafted.</p>
    </section>
    <section id="three" data-sf-section>
      <h2>3 · Three</h2>
      <p class="p-three">A paragraph in the third section.</p>
    </section>
  </main>
  <div id="sf-live">● live</div>
`;

const boot = (t, opts = {}) => bootReviewLayer(t, { body: BODY, ...opts });
const panel = (window) => window.document.getElementById('sf-asides');
const mark = (window, sectionId = 'two') =>
  window.document.querySelector(`#${sectionId} > .sf-aside-mark`);

test('the aside is moved into the panel and is no longer in the flow', async (t) => {
  const { window } = await boot(t);
  const aside = window.document.getElementById('two-aside-1');
  assert.ok(panel(window), 'the panel was built');
  assert.equal(panel(window).contains(aside), true, 'the aside lives in the panel');
  assert.equal(window.document.querySelector('main').contains(aside), false,
    'and not between the sections it used to sit between');
});

test('the nodes moved rather than being copied', async (t) => {
  // One aside, not two. A copy would double every id in the document and make
  // the gate report duplicates on a spec that has none.
  const { window } = await boot(t);
  assert.equal(window.document.querySelectorAll('#two-aside-1').length, 1);
  assert.equal(window.document.querySelectorAll('.aside-p').length, 1);
});

test('the source section carries a marker with the action icon', async (t) => {
  const { window } = await boot(t);
  const m = mark(window);
  assert.ok(m, 'the marker was built');
  assert.match(m.textContent, /⊞/, 'the icon of the action that wrote it');
  assert.equal(m.parentElement.id, 'two', 'a direct child of the section');
});

test('the marker never goes inside a block, so anchors keep their text', async (t) => {
  // A comment anchors to a block's normalized text. Chrome inside the heading
  // would change that text and orphan every thread already on it.
  const { window } = await boot(t);
  assert.equal(
    window.document.querySelector('.h-two').textContent.trim(),
    '2 · Two',
  );
  assert.equal(mark(window).closest('h2, p, li, td, th'), null, 'not inside any block');
});

test('a section with two asides gets a marker each', async (t) => {
  // Was: one marker stacking both icons. That said a draft existed somewhere in
  // the section and nothing about which paragraph, and it opened whichever aside
  // happened to be first. One marker per aside, each opening its own, is in
  // review-aside-marks.test.mjs; this holds the panel's half of it.
  const { window } = await boot(t, {
    body: BODY.replace(
      '<section id="three"',
      '<section id="two-aside-2" data-sf-aside="two" data-sf-action="go_deeper">'
      + '<h3>Aside: Go deeper</h3><p>More.</p></section><section id="three"',
    ),
  });
  const all = [...window.document.querySelectorAll('.sf-aside-mark')];
  assert.equal(all.length, 2, 'one marker per aside');
  assert.equal(all.map((m) => m.textContent).join(''), '⊞🔎', 'each carrying its own action icon');
  assert.equal(panel(window).querySelectorAll('section[data-sf-aside]').length, 2,
    'and both drafts are in the panel, one shown at a time');
});

test('the marker opens the panel', async (t) => {
  const { window } = await boot(t);
  assert.equal(panel(window).classList.contains('open'), false, 'shut on load');
  mark(window).click();
  await tick(window);
  assert.equal(panel(window).classList.contains('open'), true);
});

test('the panel takes the right gutter from the comments rail', async (t) => {
  // The rail and the drawer already take turns there. The panel joins that rule
  // rather than overlapping something.
  //
  // innerWidth above RAIL_MIN_W (1100), because jsdom defaults to 1024 and the
  // rail hides below that on its own — which would make this pass for a reason
  // that has nothing to do with the panel.
  const { window } = await boot(t, { innerWidth: 1400 });
  const rail = window.document.getElementById('sf-rail');
  assert.equal(rail.hasAttribute('hidden'), false, 'the rail is up to begin with');

  mark(window).click();
  await tick(window);
  assert.equal(rail.hasAttribute('hidden'), true, 'and yields while the panel is open');

  window.document.querySelector('#sf-asides .sf-asides-close').click();
  await tick(window);
  assert.equal(rail.hasAttribute('hidden'), false, 'and comes back when it closes');
});

test('the rail comes back to compose, because that is what the panel is for', async (t) => {
  // The panel holds sections of the spec and commenting on them is the point,
  // and every comment is composed in the rail. Hiding the rail unconditionally
  // made that a dead end: an open panel and no way to say anything about it.
  const { window } = await boot(t, { innerWidth: 1400 });
  const rail = window.document.getElementById('sf-rail');
  mark(window).click();
  await tick(window);
  assert.equal(rail.hasAttribute('hidden'), true);

  window.document.querySelector('.aside-p').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  assert.equal(rail.hasAttribute('hidden'), false, 'the rail returns for the composer');
  assert.ok(window.document.querySelector('#sf-rail .sf-bub-compose'));
  assert.equal(
    window.document.body.classList.contains('sf-asides-open'), true,
    'and the body flag stays on, which is what shifts the rail clear of the panel',
  );
});

test('Escape closes the panel', async (t) => {
  const { window } = await boot(t);
  mark(window).click();
  await tick(window);
  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(panel(window).classList.contains('open'), false);
});

test('aside content stays commentable inside the panel', async (t) => {
  // The nodes moved, but they are still the document. This is the property the
  // whole "model it as a section" decision was for.
  const { window } = await boot(t);
  mark(window).click();
  await tick(window);
  window.document.querySelector('.aside-p').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  const card = window.document.querySelector('#sf-rail .sf-bub-compose');
  assert.ok(card, 'a composer opened on a paragraph inside the panel');
  assert.match(card.querySelector('.q').textContent, /diagram the agent drafted/);
});

test('the panel chrome is not commentable', async (t) => {
  const { window } = await boot(t);
  mark(window).click();
  await tick(window);
  window.document.querySelector('#sf-asides .sf-aside-head').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  assert.equal(window.document.querySelector('#sf-rail .sf-bub-compose'), null);
});

test('a spec with no asides builds no panel and no marker', async (t) => {
  const { window } = await boot(t, {
    body: BODY.replace(/<section id="two-aside-1"[\s\S]*?<\/section>/, ''),
  });
  assert.equal(panel(window), null, 'nothing to show, so nothing is built');
  assert.equal(mark(window), null);
});

test('Import sends its comment from inside the panel, without a composer', async (t) => {
  // It used to seed the composer and wait for a second click. There is nothing
  // to add before sending: you have read the draft and you want it in.
  const { window, posts } = await boot(t);
  mark(window).click();
  await tick(window);
  const importBtn = [...window.document.querySelectorAll('#sf-asides .sf-aside-act')]
    .find((b) => b.textContent.includes('Import'));
  importBtn.click();
  await tick(window);
  assert.equal(window.document.querySelector('#sf-rail .sf-bub-compose'), null, 'no composer');
  const posted = posts.find((p) => /\/comments$/.test(p.url));
  assert.equal(posted.body.body, '@agent @import');
});

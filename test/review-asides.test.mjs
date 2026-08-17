// Asides in the review layer.
//
// An aside is a section of the spec that renders in the flow, directly under the
// one it came from. Nothing filters it: it exports, it travels on a shared link,
// and the verification gate reads it. What the review layer adds is the header
// strip that says which action wrote it and the two buttons that answer it.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootReviewLayer, rightClick } from './helpers/review-dom.mjs';

const tick = (window) => new Promise((r) => window.setTimeout(r, 0));

const BODY = `
  <main>
    <h1>Aside Spec</h1>
    <section id="two" data-sf-section>
      <h2>2 · Two</h2>
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
const strip = (window) => window.document.querySelector('#two-aside-1 .sf-aside-head');
const btn = (window, label) => [...window.document.querySelectorAll('#two-aside-1 .sf-aside-act')]
  .find((b) => b.textContent.includes(label));
// SFUI's confirm, which the review layer routes through for anything it cannot
// undo. Reused rather than reimplemented, so a delete asks the same way an
// unshare does.
const confirmDialog = (window) => window.document.querySelector('.sfui-dlg[open]');
const okButton = (window) => confirmDialog(window).querySelector('.sfui-btn.danger');

test('an aside gets a header strip naming the action that wrote it', async (t) => {
  const { window } = await boot(t);
  const head = strip(window);
  assert.ok(head, 'the strip was built');
  assert.match(head.textContent, /Visualize/, 'the action label, read from data-sf-action');
  assert.match(head.textContent, /⊞/, 'and its icon, so you can tell a diagram from an explanation');
});

test('the aside is marked so the stylesheet can offset it', async (t) => {
  const { window } = await boot(t);
  assert.ok(
    window.document.getElementById('two-aside-1').classList.contains('sf-aside'),
    'without this it reads as the next part of the argument rather than attached',
  );
});

test('an aside naming an action that no longer exists still renders', async (t) => {
  // Instructions get renamed. An aside written under an old id is still a draft
  // the reader has to answer, so it keeps its buttons and loses only the label.
  const { window } = await boot(t, {
    body: BODY.replace('data-sf-action="visualize"', 'data-sf-action="visualise"'),
  });
  assert.ok(strip(window), 'the strip is still there');
  assert.ok(btn(window, 'Import'), 'and so is the way to answer it');
});

test('the strip collapses the body without removing it', async (t) => {
  const { window } = await boot(t);
  const section = window.document.getElementById('two-aside-1');
  const body = window.document.querySelector('.aside-p');
  assert.equal(section.classList.contains('sf-aside-shut'), false, 'open on load');

  strip(window).querySelector('.sf-aside-toggle').click();
  assert.equal(section.classList.contains('sf-aside-shut'), true);
  assert.ok(body.isConnected, 'hidden, not removed: it is still a section of the spec');

  strip(window).querySelector('.sf-aside-toggle').click();
  assert.equal(section.classList.contains('sf-aside-shut'), false);
});

test('an aside opens expanded on every load', async (t) => {
  // Deliberate. A draft you collapsed and forgot is the failure worth designing
  // against, and it is waiting on a decision only you can make.
  const { window } = await boot(t);
  strip(window).querySelector('.sf-aside-toggle').click();
  const { window: reloaded } = await boot(t);
  assert.equal(
    reloaded.document.getElementById('two-aside-1').classList.contains('sf-aside-shut'),
    false,
  );
});

test('Import sends its comment straight, with no composer to fill in', async (t) => {
  // The composer existed so a qualifier could be typed. Import takes none: the
  // draft is written, you have read it, and the only question is in or out.
  const { window, posts } = await boot(t);
  btn(window, 'Import').click();
  await tick(window);
  assert.equal(window.document.querySelector('#sf-rail .sf-bub-compose'), null);
  const posted = posts.find((p) => /\/comments$/.test(p.url));
  assert.equal(posted.body.body, '@agent @import');
});

test('the import comment is anchored inside the aside it answers', async (t) => {
  // Which draft is being imported comes from where the comment sits, so this is
  // what makes the resolved thread name the right one.
  const { window, posts } = await boot(t);
  btn(window, 'Import').click();
  await tick(window);
  const posted = posts.find((p) => /\/comments$/.test(p.url));
  assert.deepEqual(posted.body.anchor.block.sectionPath, ['two-aside-1']);
});

test('an anchor on a draft quotes the draft, not the buttons on it', async (t) => {
  // The review layer injects its controls INTO the document, so a draft's
  // textContent runs "⊞Visualize← Import into specDelete …" before a word the
  // agent wrote. That text is what the reconcile matches a block by when no bid
  // is available, and it moves whenever a button is renamed.
  const { window, posts } = await boot(t);
  btn(window, 'Import').click();
  await tick(window);
  const text = posts.find((p) => /\/comments$/.test(p.url)).body.anchor.block.text;
  assert.equal(/Import into spec|Delete/.test(text), false, `chrome in the anchor: ${text}`);
  assert.match(text, /A diagram the agent drafted/, 'and the draft itself is still quoted');
});

test('Delete does not open a composer: the browser answers it', async (t) => {
  // It used to send `@agent @dismiss` and wait for an agent to delete a section.
  // There is no judgement in rejecting a draft, so the round trip bought a wait
  // and a token bill for a delete.
  const { window } = await boot(t);
  btn(window, 'Delete').click();
  await tick(window);
  assert.equal(
    window.document.querySelector('#sf-rail .sf-bub-compose'), null,
    'no comment is composed',
  );
});

test('Delete asks before it removes the draft, and deletes nothing until answered', async (t) => {
  // Nothing in the store is versioned, so a deleted draft is gone and getting it
  // back costs an agent round trip.
  const { window, dels } = await boot(t);
  btn(window, 'Delete').click();
  await tick(window);
  assert.deepEqual(dels, [], 'nothing sent while the question is open');
  assert.ok(confirmDialog(window), 'a confirmation is shown');
});

test('confirming Delete calls the endpoint for that aside', async (t) => {
  const { window, dels } = await boot(t);
  btn(window, 'Delete').click();
  await tick(window);
  okButton(window).click();
  await tick(window);
  assert.equal(dels.length, 1);
  assert.match(dels[0].url, /\/aside\/two-aside-1$/, 'the aside it was clicked on');
});

test('the panel closes on a delete, rather than reopening onto a section that is gone', async (t) => {
  const { window } = await boot(t);
  window.document.body.classList.add('sf-asides-open');
  btn(window, 'Delete').click();
  await tick(window);
  okButton(window).click();
  await tick(window);
  assert.equal(window.document.body.classList.contains('sf-asides-open'), false);
});

test('a delete the server refuses says so and leaves the panel alone', async (t) => {
  // The reader has to find out. A fulfilled fetch is not a successful delete,
  // and a silent failure reads as done until the page reloads with the draft
  // still in it.
  const { window } = await boot(t, { failPost: /\/aside\// });
  window.document.body.classList.add('sf-asides-open');
  btn(window, 'Delete').click();
  await tick(window);
  okButton(window).click();
  await tick(window);
  assert.equal(window.document.body.classList.contains('sf-asides-open'), true, 'still open');
  assert.match(window.document.body.textContent, /[Cc]ould not delete/);
});

test('Import says the review still has to be sent', async (t) => {
  // The button reads as though it acts on its own, and it does not: it writes a
  // comment, and the comment reaches the agent when the batch does. Without
  // saying so, a reader clicks it and watches nothing happen.
  const { window } = await boot(t);
  btn(window, 'Import').click();
  await tick(window);
  assert.match(window.document.body.textContent, /[Ss]end/);
});

test('an Import the server refuses is reported', async (t) => {
  // A fulfilled fetch is not an accepted comment. Silence here reads as done.
  const { window } = await boot(t, { failPost: /\/comments$/ });
  btn(window, 'Import').click();
  await tick(window);
  assert.match(window.document.body.textContent, /[Cc]ould not add/);
});

test('an aside is commentable like any section', async (t) => {
  // "This diagram has the arrow backwards" is worth saying, and without it the
  // only replies available are import and discard.
  const { window } = await boot(t);
  window.document.querySelector('.aside-p').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  assert.ok(window.document.querySelector('#sf-rail .sf-bub-compose'),
    'clicking a block inside an aside opens a composer');
});

test('the action menu opens inside an aside too', async (t) => {
  const { window } = await boot(t);
  rightClick(window, '.aside-p');
  const menu = window.document.getElementById('sf-ctx');
  assert.ok(menu.classList.contains('open'), 'an aside is a section, so it gets the menu');
  const labels = [...menu.querySelectorAll('.sf-menu-row')].map((r) => r.textContent);
  assert.equal(labels.some((l) => l.includes('Import')), false,
    'but Import is scoped to an aside and is a button, not a menu row');
});

test('the strip is review chrome, so it is not commentable and not a page click', async (t) => {
  const { window } = await boot(t);
  window.document.querySelector('p.p-two').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await tick(window);
  assert.ok(window.document.querySelector('#sf-rail .sf-bub-compose'), 'a composer is open');

  strip(window).querySelector('.sf-aside-toggle').click();
  await tick(window);
  assert.ok(
    window.document.querySelector('#sf-rail .sf-bub-compose'),
    'collapsing an aside does not cancel what was being composed elsewhere',
  );
});

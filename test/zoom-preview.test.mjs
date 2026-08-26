// The trigger and the overlay.
//
// Stage 2 is the feature at its simplest: hover a diagram, get a button, open a
// full-screen preview, close it. No zoom or pan yet, which makes it the stage
// where the invariants about the document are proved: those are about what the
// preview does NOT touch, and they are easiest to assert before there is any
// interaction on top.
//
// Spec 2cc9bae1bc, stage 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer, sizeElements, ZOOM_BODY } from './helpers/review-dom.mjs';

const boot = (t, opts = {}) => bootReviewLayer(t, { body: ZOOM_BODY, ...opts });
const settle = (window) => new Promise((r) => window.setTimeout(r, 0));

/** Hover a block the way the review layer's own mousemove does. */
function hover(window, selector) {
  const el = window.document.querySelector(selector);
  if (!el) throw new Error(`hover: nothing matches ${selector}`);
  el.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  return el;
}

const trigger = (window) => window.document.getElementById('sf-zoom-btn');
const overlay = (window) => window.document.getElementById('sf-zoom');

/** Give the fixture sizes, since fit is a ratio and jsdom computes none. */
function sized(window) {
  sizeElements(window, {
    '.z-mermaid svg': { width: 400, height: 200 },
    '.z-figure svg': { width: 300, height: 120 },
    '.z-img': { width: 200, height: 100 },
    '.z-figimg img': { width: 240, height: 160 },
    '.z-mermaid': { width: 820, height: 200 },
    '.z-figure': { width: 820, height: 140 },
  }, { width: 1600, height: 900 });
}

// --- recognising what can be previewed ----------------------------------------

test('hovering each drawable form offers a trigger', async (t) => {
  const { window } = await boot(t);
  for (const sel of ['.z-mermaid', '.z-figure', '.z-figimg', '.z-img']) {
    hover(window, sel);
    assert.ok(trigger(window), `no trigger for ${sel}`);
    assert.equal(trigger(window).hidden, false, `trigger hidden for ${sel}`);
  }
});

test('a block holding one picture offers a trigger for that picture', async (t) => {
  // Found in a browser: review.js hands over the commentable block, and in a
  // real spec that is usually a card or a table cell wrapping the image rather
  // than the image itself. Resolving only paragraphs left every gallery in the
  // store with no preview at all.
  const { window } = await boot(t);
  hover(window, '.z-card');
  assert.ok(trigger(window) && !trigger(window).hidden, 'a card holding one image offered none');

  window.SFZoom.open(window.document.querySelector('.z-card'));
  await new Promise((r) => window.setTimeout(r, 0));
  assert.equal(overlay(window).getAttribute('aria-label'), "A card's picture",
    'it opened something other than the card\'s picture');
});

test('a block holding several pictures offers none', async (t) => {
  // Which one did the reader mean? They have not said, and guessing is worse
  // than the quiet trigger not appearing.
  const { window } = await boot(t);
  hover(window, '.z-card-many');
  const btn = trigger(window);
  assert.ok(!btn || btn.hidden, 'it picked one of two pictures');
});

test('hovering anything else offers none', async (t) => {
  // The refusals carry as much of the contract as the acceptances: a mermaid
  // block that failed to render holds source text, not artwork.
  const { window } = await boot(t);
  for (const sel of ['.z-text', '.z-mermaid-err', '.z-figcaption-only']) {
    hover(window, sel);
    const btn = trigger(window);
    assert.ok(!btn || btn.hidden, `${sel} offered a trigger`);
  }
});

test('the trigger survives the pointer arriving on it', async (t) => {
  // The defect that made the whole feature unreachable with a real mouse, and
  // that a programmatic .click() in every other test walked straight past.
  //
  // review.js reports the block under the pointer. The moment the pointer
  // crosses onto the trigger the target is review chrome, so review.js reports
  // a hover of nothing — and acting on that immediately deleted the trigger the
  // instant the reader reached for it.
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  const btn = trigger(window);
  assert.equal(btn.hidden, false);

  btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  window.SFZoom.hover(null); // what review.js says once the pointer is on chrome
  assert.equal(btn.hidden, false, 'the trigger vanished as the pointer reached it');

  btn.click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(overlay(window), 'the click never reached a live button');
});

test('the held clear is honoured once the pointer leaves the trigger', async (t) => {
  // The other half: a reader who hovers the trigger and moves away without
  // clicking must not be left with a button floating over nothing.
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  const btn = trigger(window);

  btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  window.SFZoom.hover(null);
  btn.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
  assert.equal(btn.hidden, true, 'the trigger outlived its block');
});

test('moving back onto the block cancels the held clear', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  const btn = trigger(window);

  btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }));
  window.SFZoom.hover(null);
  // The pointer went back to the diagram. review.js cleared its own hoverEl on
  // the way onto the chrome, so this is a fresh block for it and it reports it.
  window.SFZoom.hover(window.document.querySelector('.z-mermaid'));
  btn.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }));
  assert.equal(btn.hidden, false, 'leaving the trigger for its own block hid it');
});

test('there is one trigger on the page, moved rather than one per block', async (t) => {
  const { window } = await boot(t);
  hover(window, '.z-mermaid');
  hover(window, '.z-figure');
  assert.equal(window.document.querySelectorAll('#sf-zoom-btn').length, 1);
});

test('the trigger follows its block when the page scrolls', async (t) => {
  // Found in a browser, invisible to the tests that preceded it: a fixed-position
  // element placed from a viewport rect is correct only until the page moves
  // under it. Scrolling with the wheel fires no mousemove, so the button sat
  // where the diagram used to be and the next click landed on whatever was
  // there now.
  const { window } = await boot(t);
  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 } },
    { width: 1600, height: 900 });
  hover(window, '.z-mermaid');
  assert.equal(trigger(window).style.top, '308px');

  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 40 } });
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(trigger(window).style.top, '48px', 'the trigger did not follow the scroll');
});

test('the trigger hides when its block scrolls out of sight', async (t) => {
  // Pinned to an edge it would offer to enlarge something no longer on screen.
  const { window } = await boot(t);
  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: 300 } },
    { width: 1600, height: 900 });
  hover(window, '.z-mermaid');
  assert.equal(trigger(window).hidden, false);

  sizeElements(window, { '.z-mermaid': { width: 820, height: 200, x: 100, y: -900 } });
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(trigger(window).hidden, true);
});

test('the trigger is a button, which is what keeps commenting working', async (t) => {
  // review.js exempts `a,button,input,textarea,select,summary,label` from the
  // block click. The tag is load-bearing, not cosmetic.
  const { window } = await boot(t);
  hover(window, '.z-mermaid');
  assert.equal(trigger(window).tagName, 'BUTTON');
  assert.equal(trigger(window).getAttribute('type'), 'button');
});

// --- I1 and I2: the document is not touched ------------------------------------

test('the trigger is never a child of the block it offers', async (t) => {
  // I2. A mermaid block's comment anchors are recorded against its rendered
  // text, so anything inserted into it moves every comment on that diagram.
  const { window } = await boot(t);
  hover(window, '.z-mermaid');
  assert.equal(window.document.querySelector('.z-mermaid #sf-zoom-btn'), null);
  assert.equal(trigger(window).parentElement, window.document.body);
});

test('opening and closing changes no block’s text', async (t) => {
  // I2, measured rather than argued.
  const { window } = await boot(t);
  sized(window);
  const before = [...window.document.querySelectorAll('main *')].map((el) => el.textContent);

  hover(window, '.z-mermaid');
  trigger(window).click();
  await settle(window);
  window.SFZoom.close();
  await settle(window);

  const after = [...window.document.querySelectorAll('main *')].map((el) => el.textContent);
  assert.deepEqual(after, before);
});

test('opening and closing leaves the document byte-identical', async (t) => {
  // I1. The clone is what makes this true: moving the original would empty the
  // block, and reconcile would re-anchor every comment on it.
  //
  // Captured AFTER the hover, deliberately. Hovering adds review.js's own
  // `sf-hover` class, which predates this feature and comes off when the pointer
  // leaves. Comparing across it would measure the hover rather than the preview.
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  const before = window.document.querySelector('main').innerHTML;

  trigger(window).click();
  await settle(window);
  assert.ok(overlay(window), 'the preview did not open');
  window.SFZoom.close();
  await settle(window);

  assert.equal(window.document.querySelector('main').innerHTML, before);
});

test('the artwork is cloned, so the original never leaves the page', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  trigger(window).click();
  await settle(window);

  assert.equal(window.document.querySelectorAll('.z-mermaid svg').length, 1, 'the original is still there');
  assert.ok(overlay(window).querySelector('svg'), 'and the overlay has its own');
  assert.notEqual(
    overlay(window).querySelector('svg'),
    window.document.querySelector('.z-mermaid svg'),
    'the overlay is showing the very node the document needs',
  );
});

// --- opening and closing --------------------------------------------------------

test('it opens on every drawable form', async (t) => {
  for (const sel of ['.z-mermaid', '.z-figure', '.z-figimg', '.z-img']) {
    const { window } = await boot(t);
    sized(window);
    hover(window, sel);
    trigger(window).click();
    await settle(window);
    assert.ok(overlay(window), `no overlay for ${sel}`);
    assert.ok(
      overlay(window).querySelector('svg, img'),
      `overlay for ${sel} holds no artwork`,
    );
  }
});

test('a mermaid diagram opens at its authored size, not the reading column’s', async (t) => {
  // Found in a browser, and invisible to every test above it. A mermaid SVG is
  // written `width="100%"` and carries its authored size only in the viewBox,
  // so a holder with no size of its own collapsed the clone to a few hundred
  // pixels: the diagram arrived SMALLER than it was in the document, which is
  // the opposite of what the reader asked for.
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  trigger(window).click();
  await settle(window);

  const holder = overlay(window).querySelector('.sf-zoom-art');
  // The fixture's viewBox is "0 0 400 200".
  assert.equal(holder.style.width, '400px');
  assert.equal(holder.style.height, '200px');
  assert.equal(holder.querySelector('svg').getAttribute('width'), '100%', 'the clone fills the holder');
});

test('an image opens at its own pixels, which is what 1:1 means for a photo', async (t) => {
  const { window } = await boot(t);
  sized(window);
  // jsdom loads no images, so naturalWidth is 0 and the width attribute is the
  // fallback the module reaches for next.
  hover(window, '.z-img');
  trigger(window).click();
  await settle(window);

  const holder = overlay(window).querySelector('.sf-zoom-art');
  assert.equal(holder.style.width, '200px');
  assert.equal(holder.style.height, '100px');
});

test('artwork that reports nothing still gets a size', async (t) => {
  // A zero would reach the view maths, and every ratio against zero is the same
  // ratio. The viewport is the last fallback.
  const { window } = await boot(t, {
    body: '<main><figure class="z-bare"><svg></svg></figure></main><div id="sf-live">live</div>',
  });
  sizeElements(window, {}, { width: 1600, height: 900 });
  hover(window, '.z-bare');
  trigger(window).click();
  await settle(window);

  const holder = overlay(window).querySelector('.sf-zoom-art');
  assert.equal(holder.style.width, '1600px');
  assert.equal(holder.style.height, '900px');
});

test('the backdrop is dark and the preview is a modal dialog', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-figure');
  trigger(window).click();
  await settle(window);

  assert.equal(overlay(window).getAttribute('role'), 'dialog');
  assert.equal(overlay(window).getAttribute('aria-modal'), 'true');
  assert.ok(overlay(window).querySelector('.sf-zoom-backdrop'), 'no backdrop');
});

test('Escape closes it', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-figure');
  trigger(window).click();
  await settle(window);

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(overlay(window), null);
});

test('clicking the backdrop closes it', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-img');
  trigger(window).click();
  await settle(window);

  overlay(window).querySelector('.sf-zoom-backdrop')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.equal(overlay(window), null);
});

test('the close button closes it', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-img');
  trigger(window).click();
  await settle(window);

  overlay(window).querySelector('.sf-zoom-close').click();
  await settle(window);
  assert.equal(overlay(window), null);
});

test('clicking the artwork does not close it', async (t) => {
  // The backdrop closes; the picture the reader came to look at does not.
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-figure');
  trigger(window).click();
  await settle(window);

  overlay(window).querySelector('svg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.ok(overlay(window), 'clicking the artwork closed the preview');
});

test('only one preview exists however many times the trigger is clicked', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  trigger(window).click();
  trigger(window).click();
  await settle(window);
  assert.equal(window.document.querySelectorAll('#sf-zoom').length, 1);
});

// --- I3 and I4: what the preview must not take -----------------------------------

test('clicking a diagram still opens a comment composer', async (t) => {
  // I3, the one cost this feature must not have.
  const { window } = await boot(t);
  const pre = window.document.querySelector('.z-mermaid');
  pre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.ok(
    window.document.querySelector('#sf-compose, .sf-compose, textarea'),
    'no composer opened on the diagram',
  );
});

test('clicking the trigger does not open a composer', async (t) => {
  const { window } = await boot(t);
  sized(window);
  hover(window, '.z-mermaid');
  trigger(window).click();
  await settle(window);
  assert.equal(window.document.querySelector('textarea'), null, 'the trigger opened a composer');
  assert.ok(overlay(window), 'and it did not open the preview');
});

test('Escape with a preview open leaves the rest of the page alone', async (t) => {
  // I4. Escape reaches a document-level handler that collapses threads and
  // cancels composers, and a keypress meant to close a picture must not cost
  // somebody an unposted draft.
  const { window } = await boot(t);
  sized(window);
  const pre = window.document.querySelector('.z-mermaid');
  pre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.ok(window.document.querySelector('textarea'), 'the composer never opened');

  // Opened through the API rather than the trigger: review.js suppresses hover
  // entirely while a composer is open (`state.composeEl` short-circuits
  // onHover), so there is no trigger to click in this state. That suppression is
  // deliberate and predates this feature; the invariant under test is about
  // Escape, not about how the preview was opened.
  window.SFZoom.open(window.document.querySelector('.z-figure'));
  await settle(window);
  assert.ok(overlay(window), 'the preview never opened');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);

  assert.equal(overlay(window), null, 'the preview did not close');
  assert.ok(window.document.querySelector('textarea'), 'Escape also cancelled the composer');
});

test('while a composer is open, no trigger is offered', async (t) => {
  // Found while writing the test above. review.js short-circuits onHover when a
  // composer is open, so the trigger never appears mid-comment. Pinned rather
  // than treated as a bug: a zoom button appearing over the block somebody is
  // writing about is noise, and the API is still there for stage 4's keyboard.
  const { window } = await boot(t);
  sized(window);
  window.document.querySelector('.z-mermaid')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);

  hover(window, '.z-figure');
  const btn = trigger(window);
  assert.ok(!btn || btn.hidden, 'a trigger appeared while composing');
});

// --- I5: a broken zoom module cannot break the review layer -----------------------

test('the review layer boots with no zoom module at all', async (t) => {
  const { window } = await boot(t, { noZoom: true });
  assert.equal(window.SFZoom, undefined);
  hover(window, '.z-mermaid');
  const pre = window.document.querySelector('.z-mermaid');
  pre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.ok(window.document.querySelector('textarea'), 'commenting broke without zoom.js');
});

test('a zoom module that throws on every call cannot break hovering', async (t) => {
  const { window } = await boot(t, {
    noZoom: true,
    preBoot: (w) => {
      w.SFZoom = { hover() { throw new Error('boom'); }, open() { throw new Error('boom'); }, close() {} };
    },
  });
  hover(window, '.z-mermaid');
  const pre = window.document.querySelector('.z-mermaid');
  pre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
  assert.ok(window.document.querySelector('textarea'), 'a throwing SFZoom broke commenting');
});

// --- the published copy ----------------------------------------------------------

test('a published copy previews too, since it writes nothing', async (t) => {
  // D5, and E4. A reviewer holding a link has the same reason to read a diagram.
  const { window } = await boot(t, { transport: 'poll', url: 'http://localhost/s/abc123' });
  sized(window);
  hover(window, '.z-mermaid');
  assert.ok(trigger(window) && !trigger(window).hidden);
  trigger(window).click();
  await settle(window);
  assert.ok(overlay(window));
});

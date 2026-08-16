// "Add to a shared project" in the spec menu.
//
// The CLI could already do it; this is the affordance where the spec is. What
// matters in the client is the shape of the choice — the projects offered are
// the ones this machine has joined — and that a published copy is never offered
// it at all, because the route it would call is the owner's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_JS = readFileSync(join(ROOT, 'server', 'public', 'review.js'), 'utf8');
const RECONCILE_JS = readFileSync(join(ROOT, 'server', 'public', 'reconcile.js'), 'utf8');
const UI_JS = readFileSync(join(ROOT, 'server', 'public', 'ui.js'), 'utf8');

const SUBS = [
  { name: 'Atelier', origin: 'https://team.example', token: 'a'.repeat(32), url: `https://team.example/p/${'a'.repeat(32)}` },
  { name: 'Gateway', origin: 'https://other.example', token: 'b'.repeat(32), url: `https://other.example/p/${'b'.repeat(32)}` },
];

/** Boot the review layer with a stubbed daemon. */
async function boot(t, opts = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><p class="a">alpha</p></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  t.after(() => window.close());
  window.SPECFORGE = {
    specId: 'test-spec',
    prefs: {},
    transport: opts.transport || 'sse',
  };
  const posts = [];
  window.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') {
      posts.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} });
      return Promise.resolve({ ok: !opts.failPost, json: () => Promise.resolve({ ok: !opts.failPost, error: 'nope' }) });
    }
    if (String(url).indexOf('/api/subscriptions') !== -1) {
      if (opts.subsFail) return Promise.reject(new Error('down'));
      // Held open when a test wants to act while the request is in flight;
      // resolving with an Error rejects, so both settle paths are drivable.
      if (opts.subsGate) {
        return opts.subsGate.then((v) => (v instanceof Error
          ? Promise.reject(v)
          : { ok: true, json: () => Promise.resolve(v) }));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ subscriptions: opts.subs || SUBS }) });
    }
    if (String(url).indexOf('/meta') !== -1) {
      return Promise.resolve({ json: () => Promise.resolve({ id: 'test-spec', title: 'T', status: 'draft', attachedSession: 's1' }) });
    }
    if (String(url).indexOf('/blocks') !== -1) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ registry: null }) });
    }
    return Promise.resolve({ text: () => Promise.resolve('{"threads":[]}') });
  };
  const add = (code) => {
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  };
  add(UI_JS);
  add(RECONCILE_JS);
  add(REVIEW_JS);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));
  return { window, posts };
}

const labels = (window) => [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
  .map((b) => b.textContent.trim());

async function openMenu(window) {
  window.document.getElementById('sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
}

test('the owner’s menu offers to add the spec to a shared project', async (t) => {
  const { window } = await boot(t);
  await openMenu(window);
  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)),
    `offered: ${labels(window).join(' | ')}`);
});

test('a published copy is not offered it', async (t) => {
  const { window } = await boot(t, { transport: 'poll' });
  await openMenu(window);
  assert.ok(!labels(window).some((l) => /Add to a shared project/.test(l)),
    'the route is the owner’s, and so is the action');
});

test('choosing it lists the projects this machine has joined', async (t) => {
  const { window } = await boot(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));

  const now = labels(window);
  assert.ok(now.some((l) => /Atelier/.test(l)), `listed: ${now.join(' | ')}`);
  assert.ok(now.some((l) => /Gateway/.test(l)));
  assert.ok(now.some((l) => /Back/.test(l)), 'and a way out');
});

// Opening the picker replaces the menu's rows, which detaches the button that
// was clicked. The outside-click handler walks up from the event target to
// decide whether the click was inside the menu, and a detached node never
// reaches it — so without stopping propagation the menu closes the instant the
// picker is built, and a reader sees the menu vanish rather than a list.
//
// The DOM-only assertions below cannot see this: closeMenu drops a class and
// leaves the rows in place. So this one asserts the class.
test('opening the picker leaves the menu open', async (t) => {
  const { window } = await boot(t);
  await openMenu(window);
  assert.ok(window.document.getElementById('sf-menu').classList.contains('open'));

  const row = [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent));
  // A real click, bubbling to the document handler, which is where it broke.
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(window.document.getElementById('sf-menu').classList.contains('open'),
    'the picker is only useful if it is on screen');
  assert.ok(labels(window).some((l) => /Atelier/.test(l)));
});

test('Back returns to the menu without closing it', async (t) => {
  const { window } = await boot(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Back/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(window.document.getElementById('sf-menu').classList.contains('open'));
  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)), 'back where we started');
});

/** Boot with the subscriptions request held open until the test releases it. */
async function bootDeferred(t, opts = {}) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const booted = await boot(t, {
    ...opts,
    subsGate: gate,
  });
  return { ...booted, release };
}

test('a slow subscriptions response does not overwrite a Back', async (t) => {
  const { window, release } = await bootDeferred(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  // Back, while the request is still in flight.
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Back/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)), 'back on the main menu');

  release({ subscriptions: SUBS });
  await new Promise((r) => window.setTimeout(r, 0));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)),
    'and the late answer did not drag the reader back to the picker');
  assert.ok(!labels(window).some((l) => /^📁?\s*Atelier$/.test(l)));
});

test('a failure arriving after a Back is dropped too', async (t) => {
  const { window, release } = await bootDeferred(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Back/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  release(new Error('down'));
  await new Promise((r) => window.setTimeout(r, 0));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(!labels(window).some((l) => /Could not load/.test(l)),
    'a failure names a screen the reader is no longer on');
  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)));
});

test('closing and reopening the menu invalidates an in-flight request', async (t) => {
  const { window, release } = await bootDeferred(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent))
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => window.setTimeout(r, 0));

  // Close, then reopen: a fresh main menu.
  window.document.getElementById('sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));
  window.document.getElementById('sf-launcher').click();
  await new Promise((r) => window.setTimeout(r, 0));

  release({ subscriptions: SUBS });
  await new Promise((r) => window.setTimeout(r, 0));
  await new Promise((r) => window.setTimeout(r, 0));

  assert.ok(labels(window).some((l) => /Add to a shared project/.test(l)),
    'the reopened menu is the reader’s current view and stays');
});

test('picking one contributes the spec to that project', async (t) => {
  const { window, posts } = await boot(t);
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Atelier/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));

  const post = posts.find((p) => /\/contribute$/.test(p.url));
  assert.ok(post, `posted: ${posts.map((p) => p.url).join(', ')}`);
  assert.equal(post.body.url, SUBS[0].url, 'to the project that was picked');
});

test('with nothing joined it says so, rather than showing an empty list', async (t) => {
  const { window } = await boot(t, { subs: [] });
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.ok(labels(window).some((l) => /No shared projects joined yet/.test(l)));
});

test('a failed contribute surfaces the reason instead of claiming success', async (t) => {
  const { window } = await boot(t, { failPost: true });
  await openMenu(window);
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));
  [...window.document.querySelectorAll('#sf-menu .sf-menu-row')]
    .find((b) => /Atelier/.test(b.textContent)).click();
  await new Promise((r) => window.setTimeout(r, 0));

  assert.match(window.document.body.textContent, /nope|Could not add/,
    'the failure is shown');
});

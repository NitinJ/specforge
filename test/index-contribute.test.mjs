// "Add to a shared project" on the home page's spec kebab.
//
// The same action the spec's own menu carries, where a person browsing the
// list would look for it. Deliberately NOT folded into "Move to project":
// filing a spec locally and publishing it into someone else's project are
// different operations, and a picker that did both would let a tidy-up publish
// a spec by accident.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec } from '../lib/store.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-idx-contrib-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const SUBS = [
  { name: 'Atelier', origin: 'https://team.example', token: 'a'.repeat(32), url: `https://team.example/p/${'a'.repeat(32)}` },
  { name: 'Gateway', origin: 'https://other.example', token: 'b'.repeat(32), url: `https://other.example/p/${'b'.repeat(32)}` },
];

const respond = (subs) => (call) => (/\/api\/subscriptions/.test(call.url)
  ? { subscriptions: subs }
  : Object.assign({ ok: true }, call.body || {}));

const menuLabels = (window) => [...window.document.querySelectorAll('.menu button')]
  .map((b) => b.textContent.trim());

async function openRowMenu(window) {
  window.document.querySelector('.row .kebab').click();
  await tick(window);
}

test('the spec kebab offers it, separately from Move to project', async (t) => {
  createSpec({ title: 'Widget themes', html: '<h1>x</h1>' });
  const { window } = loadIndex(t, {}, { respond: respond(SUBS) });
  await openRowMenu(window);
  const labels = menuLabels(window);
  assert.ok(labels.some((l) => /Move to project/.test(l)), 'filing is still there');
  assert.ok(labels.some((l) => /Add to a shared project/.test(l)),
    `and publishing is its own action: ${labels.join(' | ')}`);
});

test('choosing it lists the projects this machine has joined', async (t) => {
  createSpec({ title: 'Widget themes', html: '<h1>x</h1>' });
  const { window } = loadIndex(t, {}, { respond: respond(SUBS) });
  await openRowMenu(window);
  [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await tick(window);
  await tick(window);

  const labels = menuLabels(window);
  assert.ok(labels.some((l) => /Atelier/.test(l)), `listed: ${labels.join(' | ')}`);
  assert.ok(labels.some((l) => /Gateway/.test(l)));
});

test('picking one contributes that spec to that project', async (t) => {
  const id = createSpec({ title: 'Widget themes', html: '<h1>x</h1>' });
  const { window, calls } = loadIndex(t, {}, { respond: respond(SUBS) });
  await openRowMenu(window);
  [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await tick(window);
  await tick(window);
  [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Atelier/.test(b.textContent)).click();
  await tick(window);

  const post = calls.find((c) => c.method === 'POST' && /\/contribute$/.test(c.url));
  assert.ok(post, `posted: ${calls.map((c) => `${c.method} ${c.url}`).join(', ')}`);
  assert.equal(post.url, `/api/spec/${id}/contribute`, 'for the row it was opened on');
  assert.equal(post.body.url, SUBS[0].url, 'to the project that was picked');
});

test('with nothing joined it says so rather than showing an empty list', async (t) => {
  createSpec({ title: 'Widget themes', html: '<h1>x</h1>' });
  const { window } = loadIndex(t, {}, { respond: respond([]) });
  await openRowMenu(window);
  [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Add to a shared project/.test(b.textContent)).click();
  await tick(window);
  await tick(window);
  assert.ok(menuLabels(window).some((l) => /No shared projects/.test(l)));
});

// Filing and publishing must stay distinct: a spec dropped into a local project
// is organised, one added to a shared project is published to another machine.
test('Move to project does not offer shared projects', async (t) => {
  createSpec({ title: 'Widget themes', html: '<h1>x</h1>' });
  const { window } = loadIndex(t, {}, { respond: respond(SUBS) });
  await openRowMenu(window);
  [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Move to project/.test(b.textContent)).click();
  await tick(window);

  const picker = window.document.getElementById('cpick');
  assert.ok(picker && !picker.hidden, 'the filing picker opened');
  assert.doesNotMatch(picker.textContent, /Atelier|Gateway/,
    'a local move must never reach someone else’s machine');
});

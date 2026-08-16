// The theme toggle on a shared project page.
//
// The page had no switcher: it followed prefers-color-scheme and a reader whose
// OS disagreed with them had no way to say so. The choice is stored in the
// reader's own localStorage, never on the owner's machine, because this page
// makes no writes off the browser and a preference is not worth the exception
// (spec 82f5dabccf, R9).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-ptheme-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { renderProjectPage } = await import('../server/project-page.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { readMeta, writeMeta } = await import('../lib/meta.mjs');

const TOK = 'e'.repeat(32);

function seed(title) {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = 'Atelier';
  writeMeta(id, m);
  return id;
}

/** A jsdom running the page's own scripts, which is where the toggle lives. */
function open(t) {
  seed('Widget themes');
  const { window } = new JSDOM(renderProjectPage('Atelier', TOK), {
    url: `https://team.example/p/${TOK}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  t.after(() => window.close());
  return window;
}

test('the toggle flips the document theme', (t) => {
  const w = open(t);
  const root = w.document.documentElement;
  const before = root.getAttribute('data-theme');
  w.document.getElementById('sf-theme').click();
  assert.notEqual(root.getAttribute('data-theme'), before, 'the attribute changed');
  assert.match(root.getAttribute('data-theme'), /^(light|dark)$/);
});

test('the choice is remembered in the reader’s own browser', (t) => {
  const w = open(t);
  w.document.getElementById('sf-theme').click();
  const chosen = w.document.documentElement.getAttribute('data-theme');
  assert.equal(w.localStorage.getItem('sf-theme'), chosen);
});

test('a stored choice is applied before the body paints', (t) => {
  // The applying snippet is in <head>, ahead of <body>, so a reader who chose
  // light never sees a dark flash. Asserted on source order because a jsdom
  // cannot see a flash.
  seed('Widget themes');
  const html = renderProjectPage('Atelier', TOK);
  const applied = html.indexOf("localStorage.getItem('sf-theme')");
  assert.ok(applied > 0, 'the page reads a stored choice');
  assert.ok(applied < html.indexOf('<body'), 'and does so before <body>');
});

test('toggling twice returns to where it started', (t) => {
  const w = open(t);
  const btn = w.document.getElementById('sf-theme');
  const root = w.document.documentElement;
  btn.click();
  const first = root.getAttribute('data-theme');
  btn.click();
  const second = root.getAttribute('data-theme');
  assert.notEqual(first, second);
  btn.click();
  assert.equal(root.getAttribute('data-theme'), first, 'and back again');
});

test('the icon shows the theme in force, not the one a click would give', (t) => {
  const w = open(t);
  const btn = w.document.getElementById('sf-theme');
  const moonThenSun = () => (btn.innerHTML.includes('circle') ? 'light' : 'dark');
  assert.equal(moonThenSun(), w.document.documentElement.getAttribute('data-theme') || 'dark');
  btn.click();
  assert.equal(moonThenSun(), w.document.documentElement.getAttribute('data-theme'));
});

/**
 * A page whose matchMedia is a fake we can drive.
 *
 * jsdom never evaluates media queries, so a real prefers-color-scheme change
 * cannot happen in it. The fake records listeners and lets the test fire one,
 * which is the only part of the behaviour the page owns.
 */
function openWithFakeMedia(t, { light }) {
  seed('Widget themes');
  let matches = light;
  const listeners = [];
  const { window } = new JSDOM(renderProjectPage('Atelier', TOK), {
    url: `https://team.example/p/${TOK}`,
    runScripts: 'dangerously',
    beforeParse(w) {
      w.matchMedia = (media) => ({
        media,
        get matches() { return matches; },
        addEventListener: (_, fn) => listeners.push(fn),
        removeEventListener: () => {},
      });
    },
  });
  t.after(() => window.close());
  return {
    window,
    listeners,
    flipOsTo(next) {
      matches = next === 'light';
      for (const fn of listeners) fn({ matches });
    },
  };
}

test('the icon follows the OS when the reader has made no choice', (t) => {
  const { window, flipOsTo } = openWithFakeMedia(t, { light: true });
  const btn = window.document.getElementById('sf-theme');
  const showing = () => (btn.innerHTML.includes('circle') ? 'light' : 'dark');
  assert.equal(showing(), 'light', 'the OS says light, so the icon says light');
  // Sunset: the CSS repaints on its own, and the icon has to follow or it names
  // a theme that is no longer in force.
  flipOsTo('dark');
  assert.equal(showing(), 'dark');
});

test('a stored choice pins the icon against an OS change', (t) => {
  const { window, flipOsTo } = openWithFakeMedia(t, { light: true });
  const btn = window.document.getElementById('sf-theme');
  btn.click();
  const chosen = window.document.documentElement.getAttribute('data-theme');
  flipOsTo('dark');
  assert.equal(window.document.documentElement.getAttribute('data-theme'), chosen,
    'the reader’s choice outranks the OS');
  assert.equal(btn.innerHTML.includes('circle') ? 'light' : 'dark', chosen);
});

test('nothing about the theme reaches the owner’s machine', () => {
  seed('Widget themes');
  const html = renderProjectPage('Atelier', TOK);
  // The page-wide guarantee from spec 82f5dabccf, re-asserted now that the page
  // has a second script: a preference is a browser write, not a daemon call.
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost/);
  assert.doesNotMatch(html, /method:\s*['"]POST/i);
  assert.doesNotMatch(html, /fetch\s*\(/, 'and no request at all');
});

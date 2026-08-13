// A hidden tab gives its connection back.
//
// A browser allows about six connections per origin over HTTP/1.1, across every
// tab, and an event stream holds one for as long as its tab exists. Six open
// specs saturated the origin: the seventh tab could not load and every other
// tab's requests — Submit among them — queued behind streams that never finish.
//
// These run the injected snippet for real rather than matching its source, so
// they fail if the lifecycle breaks rather than if the wording changes.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM, VirtualConsole } from 'jsdom';

import { injectReviewLayer } from '../server/inject.mjs';

const HTML = '<!doctype html><html><head></head><body><h1>x</h1></body></html>';

let home;
let prevHome;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-vis-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/**
 * Boot the injected watcher with EventSource and fetch stubbed.
 *
 * The page's own scripts are NOT run by jsdom (outside-only): they execute
 * during construction, which is before there is a window to stub. They are
 * pulled out and evaluated once the fakes are in place.
 */
function boot({ hidden = false, mtime = () => 100 } = {}) {
  const out = injectReviewLayer(HTML, { specId: 'abc123' });
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => jsdomErrors.push(e.message));
  const dom = new JSDOM(out, { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole });
  const { window } = dom;

  const streams = [];
  window.EventSource = function (url) {
    const self = this;
    self.url = url;
    self.closed = false;
    self.listeners = {};
    self.addEventListener = (k, fn) => { self.listeners[k] = fn; };
    self.close = () => { self.closed = true; };
    streams.push(self);
  };

  let isHidden = hidden;
  Object.defineProperty(window.document, 'hidden', { get: () => isHidden, configurable: true });

  const stateCalls = [];
  window.fetch = (url) => {
    stateCalls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ spec: mtime(), comments: 1, busy: false }) });
  };

  // Run the two inline scripts (window.SPECFORGE, then the watcher IIFE).
  for (const m of out.matchAll(/<script>([\s\S]*?)<\/script>/g)) window.eval(m[1]);

  const flip = async (next) => {
    isHidden = next;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    window,
    streams,
    stateCalls,
    flip,
    open: () => streams.filter((s) => !s.closed),
    // location.reload is unforgeable in jsdom; it raises a "not implemented"
    // jsdomError instead, which is the only way to observe that it was called.
    reloads: () => jsdomErrors.filter((m) => /reload|navigation/i.test(m)).length,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a visible tab holds one stream', async () => {
  const t = boot();
  assert.equal(t.streams.length, 1);
  assert.match(t.streams[0].url, /\/events\?spec=abc123/);
  assert.equal(t.open().length, 1);
});

test('hiding the tab closes the stream, so the connection goes back', async () => {
  const t = boot();
  await t.flip(true);
  assert.equal(t.open().length, 0, 'nothing is held while nobody is reading');
  assert.equal(t.streams[0].closed, true);
});

test('showing it again opens a fresh stream', async () => {
  const t = boot();
  await t.flip(true);
  await t.flip(false);
  assert.equal(t.streams.length, 2, 'a new stream, not a resurrected one');
  assert.equal(t.open().length, 1);
});

test('a tab that starts hidden takes no connection at all', async () => {
  // Opening a spec in a background tab must not cost a slot before it is read.
  const t = boot({ hidden: true });
  assert.equal(t.streams.length, 0);
  await t.flip(false);
  assert.equal(t.open().length, 1, 'and takes one the moment it is looked at');
});

test('coming back to an unchanged document does not reload', async () => {
  const t = boot({ mtime: () => 100 });
  await settle();
  await t.flip(true);
  await t.flip(false);
  assert.equal(t.reloads(), 0);
});

test('coming back to a document that moved reloads it', async () => {
  // The stream was not listening while hidden, so nothing delivered the change.
  // Asking on the way back is what replaces the event that never arrived.
  let m = 100;
  const t = boot({ mtime: () => m });
  await settle();
  await t.flip(true);
  m = 200;
  await t.flip(false);
  assert.equal(t.reloads(), 1);
});

test('a tab opened in the background still catches a change it never saw', async () => {
  // shownAt is captured at load even while hidden, so the first view compares
  // against the document as it was when the tab was opened.
  let m = 100;
  const t = boot({ hidden: true, mtime: () => m });
  await settle();
  m = 200;
  await t.flip(false);
  assert.equal(t.reloads(), 1);
});

test('the disconnection banner is not raised by a stream we let go of', async () => {
  // Otherwise every return from a background tab is greeted by "Live connection
  // lost", for a connection that was closed deliberately.
  const t = boot();
  const banner = t.window.document.getElementById('sf-disconnected');
  await t.flip(true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(banner.hasAttribute('hidden'), true);
});

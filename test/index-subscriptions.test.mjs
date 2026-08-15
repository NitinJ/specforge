// The Shared-with-me rail: subscription cards on the home page.
//
// Server-side it renders the last-known name and the link out to the owner's
// origin; freshness and reachability are the client script's job, so what is
// pinned here is the markup contract that script and the reader depend on.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { renderIndex } from '../server/daemon.mjs';
import { addSubscription } from '../lib/store-subscriptions.mjs';
import { createSpec } from '../lib/store.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-index-subs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const TOK = 'd'.repeat(32);

test('a subscription renders as a card linking out to the owner origin', () => {
  addSubscription({ name: 'Atelier', origin: 'https://their.example', token: TOK });
  const html = renderIndex();
  assert.match(html, /Shared with me/);
  assert.match(html, /Atelier/);
  assert.ok(html.includes(`href="https://their.example/p/${TOK}"`), 'links out, never proxies');
  assert.match(html, /target="_blank"/);
  assert.ok(html.includes(`data-meta="https://their.example/p/${TOK}/api/meta"`),
    'the client refresh knows where the public meta lives');
});

test('with no subscriptions the rail does not render at all', () => {
  createSpec({ title: 'Local only', html: '<h1>x</h1>' });
  const html = renderIndex();
  // The stylesheet always carries its comment; the markup is what must be
  // absent: no rail nav, no rail heading element.
  assert.doesNotMatch(html, /id="subs"/);
  assert.doesNotMatch(html, /<div class="shead">Shared with me<\/div>/);
});

test('a subscription name is escaped on the way into the page', () => {
  addSubscription({ name: '<img src=x onerror=alert(1)>', origin: 'https://their.example', token: TOK });
  const html = renderIndex();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

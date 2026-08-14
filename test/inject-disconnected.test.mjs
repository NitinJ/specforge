import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { injectReviewLayer } from '../server/inject.mjs';

const HTML = '<!doctype html><html><head></head><body><h1>x</h1></body></html>';

let home;
let prevHome;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-inject-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('inject adds a disconnection banner, hidden by default', () => {
  const out = injectReviewLayer(HTML, { specId: 'abc123' });
  assert.match(out, /<div id="sf-disconnected"[^>]*\bhidden\b/, 'banner present and hidden by default');
  assert.match(out, /role="alert"/, 'announced to assistive tech');
  assert.match(out, /sf-dc-reload/, 'has a reload affordance');
});

test('inject wires the SSE connection to the banner with a grace debounce', () => {
  const out = injectReviewLayer(HTML, { specId: 'abc123' });
  assert.match(out, /es\.onopen\s*=\s*connected/, 'open hides the banner');
  assert.match(out, /es\.onerror\s*=\s*disconnected/, 'error arms the banner');
  assert.match(out, /GRACE\s*=\s*4000/, 'debounced by a grace period so blips do not flash it');
  // specId must be JSON-quoted, else the injected script throws and review.js bails.
  assert.match(out, /window\.SPECFORGE = \{"specId":"abc123"/, 'specId injected quoted');
  // The loopback listener streams; only a publication polls.
  assert.match(out, /"transport":"sse"/, 'loopback keeps the event stream');
});

// The bug: a published page asked the origin ROOT for its state. Every route on
// the gateway lives under /s/<token>, so the root 404s, two misses in a row read
// as a dead connection, and the reader is told the spec is stale and their
// comments will not save — while the comments API, which does use the base it was
// given, has been saving them the whole time.
test('a published page polls the state route it was actually given', () => {
  const out = injectReviewLayer(HTML, { specId: 'abc123', transport: 'poll', api: '/s/tok/api' });
  assert.match(out, /"transport":"poll"/, 'a publication cannot hold a stream');
  assert.match(out, /statePath="\/s\/tok\/api\/state"/, 'polls under the api base it was given');
  assert.doesNotMatch(out, /'\/api\/state'/, 'the gateway serves nothing at the origin root');
});

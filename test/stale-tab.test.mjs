// A published page that learns the spec moved goes stale rather than reloading
// itself (spec 82f5dabccf, D11).
//
// Two properties, and the second is the one that made this a design decision
// rather than a nicety: a stale page stops reporting which paragraphs exist.
// Comments anchor to paragraphs and retirement is durable, so a tab showing an
// old version would report the owner's rewritten paragraphs as deleted and
// detach the comments on them.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-stale-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { injectReviewLayer } = await import('../server/inject.mjs');

const SPEC = '<!DOCTYPE html><html><head><title>x</title></head><body><p>a paragraph</p></body></html>';

test('a published page carries the stale bar; an owner page does not', () => {
  const published = injectReviewLayer(SPEC, { specId: 'x', transport: 'poll', api: '/s/tok/api' });
  assert.match(published, /id="sf-stale"/);
  assert.match(published, /Show the new version/);
  assert.match(published, /The owner has updated this spec/);

  const owner = injectReviewLayer(SPEC, { specId: 'x' });
  assert.doesNotMatch(owner, /id="sf-stale"/, 'the owner’s own tabs live-reload');
});

test('the published watcher goes stale instead of reloading itself', () => {
  const published = injectReviewLayer(SPEC, { specId: 'x', transport: 'poll', api: '/s/tok/api' });
  // The poll used to call location.reload() the moment the mtime moved.
  assert.match(published, /goStale\(\)/);
  assert.doesNotMatch(published, /held && !s\.busy\)\{ location\.reload/,
    'a reader mid-sentence is not yanked');
  // The reader's own choice still reloads.
  assert.match(published, /onclick="location\.reload\(\)"/);
});

test('going stale sets the flag the review layer reads, and says so in the pill', () => {
  const published = injectReviewLayer(SPEC, { specId: 'x', transport: 'poll', api: '/s/tok/api' });
  assert.match(published, /window\.SPECFORGE\.stale\s*=\s*true/);
  assert.match(published, /new version/);
  assert.match(published, /sf-stale'\)/, 'and announces it for anything listening');
});

test('the owner page still reloads on its stream', () => {
  const owner = injectReviewLayer(SPEC, { specId: 'x' });
  assert.match(owner, /addEventListener\('reload'/);
  assert.match(owner, /location\.reload\(\)/);
});

// The page is baselined against the file it was RENDERED from, not against
// whatever the first poll happens to find. An owner writing between the
// response and that first request would otherwise be recorded as already-seen:
// the page would show the old document, believe itself current, and go on
// reporting paragraphs the owner had just rewritten.
test('the baseline is the served version, stamped at serve time', async () => {
  const { createSpec, specHtmlPath } = await import('../lib/store.mjs');
  const { writeFileSync, statSync, utimesSync } = await import('node:fs');
  const id = createSpec({ title: 'Served', html: '<p>first</p>' });

  const first = injectReviewLayer(SPEC, { specId: id, transport: 'poll', api: '/s/tok/api' });
  const servedAt = statSync(specHtmlPath(id)).mtimeMs;
  assert.ok(first.includes(`var last=${JSON.stringify(servedAt)}`),
    'the page carries the mtime of the bytes it was built from');
  assert.doesNotMatch(first, /last===null/, 'and never baselines from a later poll');

  // The owner writes; a page served after that carries the newer stamp, so two
  // readers who loaded either side of the write disagree, correctly. The mtime
  // is set explicitly rather than left to the clock: two writes inside one
  // filesystem tick share an mtime, which would make this pass or fail on
  // timing rather than on behaviour.
  writeFileSync(specHtmlPath(id), '<p>second</p>');
  const later = (Date.now() + 5000) / 1000;
  utimesSync(specHtmlPath(id), later, later);
  const second = injectReviewLayer(SPEC, { specId: id, transport: 'poll', api: '/s/tok/api' });
  assert.ok(!second.includes(`var last=${JSON.stringify(servedAt)}`),
    'a later response carries a later baseline');
});

// The stamp is the caller's reading, taken before it read the bytes. A write
// landing between the two then pairs NEW bytes with an OLD stamp: one spurious
// notice, no lost anchors. The other order pairs old bytes with a new stamp,
// and the page believes itself current forever.
test('the gateway stamps the mtime it read before the bytes', async () => {
  const { createGatewayServer } = await import('../lib/gateway.mjs');
  const { createSpec, specHtmlPath } = await import('../lib/store.mjs');
  const { newToken } = await import('../lib/tokens.mjs');
  const { statSync, utimesSync } = await import('node:fs');

  const id = createSpec({ title: 'Served', html: '<p>first</p>' });
  const tok = newToken();
  const server = createGatewayServer((t) => (t === tok ? id : null));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(`${base}/s/${tok}`)).text();
    assert.ok(page.includes(`var last=${JSON.stringify(statSync(specHtmlPath(id)).mtimeMs)}`),
      'the stamp is this spec’s current mtime, not a placeholder');

    // The owner writes. The next reader is stamped later, so an earlier
    // reader's page is the one that goes stale, which is the point.
    const stampOf = (html) => html.match(/var last=([\d.]+)/)[1];
    const before = stampOf(page);
    const later = (Date.now() + 5000) / 1000;
    utimesSync(specHtmlPath(id), later, later);

    const after = stampOf(await (await fetch(`${base}/s/${tok}`)).text());
    assert.equal(after, String(statSync(specHtmlPath(id)).mtimeMs),
      'a later response carries the later stamp');
    assert.notEqual(after, before, 'and the two readers disagree, correctly');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// An agent mid-round writes a section at a time. Announcing staleness per write
// would flash the bar repeatedly through one round of review.
test('staleness waits for the agent to finish its round', () => {
  const published = injectReviewLayer(SPEC, { specId: 'x', transport: 'poll', api: '/s/tok/api' });
  assert.match(published, /held\s*&&\s*!s\.busy/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { build, search, snippet, tokenize, topTerms } from '../lib/bm25.mjs';

const DOCS = [
  { id: 'auth', heading: 'Authentication flow', text: 'The login endpoint verifies a token and issues a session cookie.' },
  { id: 'billing', heading: 'Billing', text: 'Credits are deducted per request; the agent verifies the balance before charging.' },
  { id: 'misc', heading: 'Glossary', text: 'A token is a short opaque string. The endpoint table lists every route.' },
];

test('tokenize: lowercases, splits on non-alphanumerics, keeps numbers/identifiers, drops stopwords', () => {
  assert.deepEqual(tokenize('GET /v1/tryon, k1=1.4!'), ['get', 'v1', 'tryon', 'k1', '1', '4']);
  assert.deepEqual(tokenize('the AND of'), []); // all stopwords
});

test('search: ranks the section that matches query terms', () => {
  const idx = build(DOCS);
  const hits = search(idx, 'login session cookie');
  assert.equal(hits[0].id, 'auth');
  assert.ok(hits[0].score > 0);
});

test('search: heading-field boost lifts a title match above a body-only mention', () => {
  const idx = build(DOCS);
  // "billing" appears only in the billing heading; nowhere else.
  const hits = search(idx, 'billing');
  assert.equal(hits[0].id, 'billing');

  // "endpoint" appears in auth body and misc body; "authentication" only in auth heading.
  const auth = search(idx, 'authentication endpoint');
  assert.equal(auth[0].id, 'auth', 'heading term tips the balance to auth');
});

test('search: returns a snippet around the best hit', () => {
  const idx = build(DOCS);
  const [top] = search(idx, 'cookie');
  assert.match(top.snippet, /cookie/i);
});

test('search: respects limit and emits only positive scores', () => {
  const idx = build(DOCS);
  const hits = search(idx, 'token', { limit: 1 });
  assert.equal(hits.length, 1);
  for (const h of search(idx, 'token')) assert.ok(h.score > 0);
});

test('search: no-match query returns empty', () => {
  const idx = build(DOCS);
  assert.deepEqual(search(idx, 'zzzznomatch'), []);
});

test('search: stable ordering on score ties (id tiebreak)', () => {
  const idx = build([
    { id: 'b', heading: '', text: 'alpha' },
    { id: 'a', heading: '', text: 'alpha' },
  ]);
  const hits = search(idx, 'alpha');
  assert.deepEqual(hits.map((h) => h.id), ['a', 'b']);
});

test('snippet: trims to width with ellipsis and centers on the hit', () => {
  const long = 'x '.repeat(200) + 'NEEDLE here ' + 'y '.repeat(200);
  const s = snippet(long, new Set(['needle']), 60);
  assert.match(s, /NEEDLE/);
  assert.ok(s.length <= 64);
  assert.ok(s.startsWith('…'));
});

test('topTerms: returns the highest-weighted terms for a doc', () => {
  const idx = build(DOCS);
  const terms = topTerms(idx, 'auth', 3);
  assert.ok(terms.includes('authentication'), 'heading term dominates');
  assert.equal(terms.length, 3);
});

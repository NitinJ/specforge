// Reading and writing a spec's display title.
//
// These two are inverses. setTitle escapes on the way in; getTitle has to decode
// on the way out, or a title round-trips into meta.json still escaped and every
// renderer escapes it a second time.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTitle, setTitle } from '../lib/spec.mjs';

const doc = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

test('a plain title reads back as itself', () => {
  assert.equal(getTitle(doc('App URL Opens')), 'App URL Opens');
});

test('the trailing " · Spec" suffix is dropped', () => {
  assert.equal(getTitle(doc('App URL Opens — Spec')), 'App URL Opens');
});

test('a document with no title is not fatal', () => {
  assert.equal(getTitle('<html><body>hi</body></html>'), 'Untitled spec');
  assert.equal(getTitle(doc('   ')), 'Untitled spec');
});

// The bug this exists for: an ampersand in a title was stored as `&amp;` in
// meta.json, then escaped again at render, so the index showed a literal
// "&amp;" in the row.
test('entities are decoded, so the title is text rather than markup', () => {
  assert.equal(getTitle(doc('Universal Links, App Links &amp; In-App Routing')),
    'Universal Links, App Links & In-App Routing');
  assert.equal(getTitle(doc('a &lt;tag&gt; in a title')), 'a <tag> in a title');
  assert.equal(getTitle(doc('&quot;quoted&quot;')), '"quoted"');
  assert.equal(getTitle(doc('it&#39;s fine')), "it's fine");
});

// &amp; has to be decoded last. Decoding it first turns `&amp;lt;` into `&lt;`
// and then into `<`, which is a title that was never written.
test('an escaped entity stays escaped', () => {
  assert.equal(getTitle(doc('write &amp;lt; for a less-than')), 'write &lt; for a less-than');
});

test('setTitle and getTitle round-trip', () => {
  for (const title of [
    'Universal Links, App Links & In-App Routing',
    'a <tag> in a title',
    'Cost $2/mo & rising',
    '"quoted" and it\'s fine',
  ]) {
    assert.equal(getTitle(setTitle(doc('placeholder'), title)), title, `round-trip: ${title}`);
  }
});

test('setTitle rewrites both the title element and the h1', () => {
  const out = setTitle(doc('old'), 'new & improved');
  assert.match(out, /<title>new &amp; improved<\/title>/);
  assert.match(out, /<h1>new &amp; improved<\/h1>/);
});

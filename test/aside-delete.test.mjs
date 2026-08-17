// Deleting an aside from a spec.
//
// This is the one place the browser removes something from spec.html, so what
// it refuses matters more than what it does. Inline section editing was taken
// out of SpecForge in v0.2.47 because a browser editing spec source was not
// what the review layer is for. A delete is not that: the target is a section
// SpecForge itself wrote, identified by an attribute nothing else carries, and
// the operation has no source for a user to get wrong.
//
// So the guard is the whole design: without `data-sf-aside` on the section, the
// delete refuses. That is what keeps a URL naming any section from removing it.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteAside } from '../lib/actions/delete-aside.mjs';

const SPEC = `<!doctype html><html><body><main>
  <section id="object"><h2>1 · Object</h2><p>First.</p></section>
  <section id="object-aside-1" data-sf-aside="object" data-sf-block="b4" data-sf-action="visualize">
    <h3>Aside: Visualize</h3><figure><img alt="d"></figure></section>
  <section id="object-aside-2" data-sf-aside="object" data-sf-action="go_deeper">
    <h3>Aside: Go deeper</h3><p>More.</p></section>
  <section id="next"><h2>2 · Next</h2><p>Last.</p></section>
</main></body></html>`;

test('an aside is removed and nothing around it moves', () => {
  const out = deleteAside(SPEC, 'object-aside-1');
  assert.equal(out.html.includes('object-aside-1'), false);
  assert.equal(out.html.includes('id="object"'), true, 'its source section stays');
  assert.equal(out.html.includes('object-aside-2'), true, 'the other draft stays');
  assert.equal(out.html.includes('id="next"'), true);
});

test('the aside it removed is reported, so the caller can drop its threads', () => {
  const out = deleteAside(SPEC, 'object-aside-2');
  assert.equal(out.aside, 'object-aside-2');
  assert.equal(out.section, 'object', 'and the section it belonged to');
});

test('a section that is not an aside is refused', () => {
  // The guard this whole module exists for. Without it, a request naming any
  // section id deletes that section, and the browser has a way to remove a
  // reader's own writing.
  assert.throws(() => deleteAside(SPEC, 'object'), /not an aside/);
  assert.throws(() => deleteAside(SPEC, 'next'), /not an aside/);
});

test('a section that is not there is refused rather than silently doing nothing', () => {
  // A no-op returning success reads to the browser as "deleted", and the aside
  // is still on screen after the reload.
  assert.throws(() => deleteAside(SPEC, 'object-aside-9'), /no section/);
});

test('an aside holding a nested section is removed whole', () => {
  // The depth-counted splicer, which a non-greedy `</section>` would get wrong:
  // it would cut at the inner close and leave the aside's tail in the document.
  const nested = `<section id="a"><h2>A</h2></section>
    <section id="a-aside-1" data-sf-aside="a" data-sf-action="go_deeper">
      <h3>Aside</h3><section id="inner"><p>Nested.</p></section></section>
    <section id="b"><h2>B</h2></section>`;
  const out = deleteAside(nested, 'a-aside-1');
  assert.equal(out.html.includes('a-aside-1'), false);
  assert.equal(out.html.includes('inner'), false, 'the nested one goes with it');
  assert.equal(out.html.includes('id="b"'), true, 'and B is untouched');
  assert.equal(/<\/section>\s*<section id="b">/.test(out.html), true, 'no orphaned close tag');
});

test('deleting the last aside leaves the document well formed', () => {
  let html = SPEC;
  html = deleteAside(html, 'object-aside-1').html;
  html = deleteAside(html, 'object-aside-2').html;
  assert.equal(html.includes('data-sf-aside'), false);
  const opens = (html.match(/<section\b/g) || []).length;
  const closes = (html.match(/<\/section>/g) || []).length;
  assert.equal(opens, closes, 'tags still balance');
  assert.equal(opens, 2, 'the two real sections');
});

test('an id that looks like a regex is matched literally', () => {
  // Section ids are author-written and nothing stops one holding a dot.
  const odd = '<section id="v1.2"><h2>V</h2></section>'
    + '<section id="v1.2-aside-1" data-sf-aside="v1.2" data-sf-action="go_deeper"><h3>A</h3></section>'
    + '<section id="v1x2-aside-1"><h2>Decoy</h2></section>';
  const out = deleteAside(odd, 'v1.2-aside-1');
  assert.equal(out.html.includes('v1.2-aside-1'), false);
  assert.equal(out.html.includes('v1x2-aside-1'), true, 'the decoy is untouched');
});

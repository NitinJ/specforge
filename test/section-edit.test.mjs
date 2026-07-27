// Unit tests for the section splice used by the inline section editor
// (lib/section-edit.mjs): locate a <section id="…"> in the on-disk spec HTML and
// read / replace its INNER html, keeping the <section> wrapper (id + classes)
// immutable. Depth-aware (nested sections), attribute-order and quote agnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSectionInner, replaceSectionInner } from '../lib/section-edit.mjs';

test('getSectionInner returns a section body by id', () => {
  const html = '<body><section id="a"><h2>A</h2><p>x</p></section></body>';
  assert.equal(getSectionInner(html, 'a'), '<h2>A</h2><p>x</p>');
});

test('getSectionInner is agnostic to attribute order and quote style', () => {
  const html = "<body><section class=\"lead\" id='a' data-k=1><p>x</p></section></body>";
  assert.equal(getSectionInner(html, 'a'), '<p>x</p>');
});

test('getSectionInner handles unquoted id attributes', () => {
  const html = '<body><section id=a><p>x</p></section></body>';
  assert.equal(getSectionInner(html, 'a'), '<p>x</p>');
});

test('getSectionInner is depth-aware: outer includes the nested section verbatim', () => {
  const html = '<body><section id="outer"><h2>O</h2><section id="inner"><p>i</p></section><p>o</p></section></body>';
  assert.equal(getSectionInner(html, 'outer'),
    '<h2>O</h2><section id="inner"><p>i</p></section><p>o</p>');
  assert.equal(getSectionInner(html, 'inner'), '<p>i</p>');
});

test('getSectionInner does not match a section whose id merely contains the query', () => {
  const html = '<body><section id="abc"><p>x</p></section></body>';
  assert.equal(getSectionInner(html, 'a'), null);
});

test('getSectionInner does not match a look-alike tag like <sectionx>', () => {
  const html = '<body><sectionx id="a"><p>x</p></sectionx></body>';
  assert.equal(getSectionInner(html, 'a'), null);
});

test('getSectionInner returns null when the section is absent', () => {
  assert.equal(getSectionInner('<body><section id="a"><p>x</p></section></body>', 'missing'), null);
});

test('replaceSectionInner swaps the body and keeps the wrapper + siblings intact', () => {
  const html = '<body><h1>T</h1><section id="a" class="lead"><p>old</p></section><footer>f</footer></body>';
  const out = replaceSectionInner(html, 'a', '<p>new</p><p>more</p>');
  assert.equal(out,
    '<body><h1>T</h1><section id="a" class="lead"><p>new</p><p>more</p></section><footer>f</footer></body>');
  // The wrapper (id + class) survives — only the inner changed.
  assert.equal(getSectionInner(out, 'a'), '<p>new</p><p>more</p>');
});

test('replaceSectionInner on the outer section leaves other sections untouched', () => {
  const html = '<body><section id="a"><p>a</p></section><section id="b"><p>b</p></section></body>';
  const out = replaceSectionInner(html, 'a', '<p>A2</p>');
  assert.equal(getSectionInner(out, 'a'), '<p>A2</p>');
  assert.equal(getSectionInner(out, 'b'), '<p>b</p>', 'sibling section is not disturbed');
});

test('replaceSectionInner returns null when the section is absent', () => {
  assert.equal(replaceSectionInner('<body><section id="a"><p>x</p></section></body>', 'missing', '<p>y</p>'), null);
});

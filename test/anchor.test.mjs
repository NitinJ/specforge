import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnchor, toText } from '../lib/anchor.mjs';

const wrap = (inner) => `<section id="s1" data-sf-section><p>${inner}</p></section>`;
const BASE = wrap('The quick brown fox jumps over the lazy dog.');

test('toText strips tags and decodes entities (textContent semantics)', () => {
  assert.equal(toText('<p>a &amp; b c</p>'), 'a & b c');
  // tag boundaries do not introduce whitespace, matching DOM textContent
  assert.equal(toText('<p>b<br>c</p>'), 'bc');
});

test('precise: exact quote present', () => {
  const r = resolveAnchor(BASE, { sectionId: 's1', quote: { exact: 'brown fox', prefix: 'quick ', suffix: ' jumps' } });
  assert.equal(r.status, 'precise');
  assert.equal(typeof r.start, 'number');
});

test('precise survives surrounding-context edits (quote text intact)', () => {
  const edited = wrap('A speedy brown fox leaps over a sleepy dog.');
  const r = resolveAnchor(edited, { sectionId: 's1', quote: { exact: 'brown fox', prefix: 'quick ', suffix: ' jumps' } });
  assert.equal(r.status, 'precise');
});

test('moved: most of the quote words survive', () => {
  const edited = wrap('The quick brown fox leaps over the lazy dog.'); // jumps -> leaps
  const r = resolveAnchor(edited, { sectionId: 's1', quote: { exact: 'quick brown fox jumps' } });
  assert.equal(r.status, 'moved');
});

test('section: quote text replaced entirely falls back to the section', () => {
  const edited = wrap('Totally unrelated paragraph content here.');
  const r = resolveAnchor(edited, { sectionId: 's1', quote: { exact: 'quick brown fox jumps' } });
  assert.equal(r.status, 'section');
});

test('section: a comment with no quote anchors to the whole section', () => {
  const r = resolveAnchor(BASE, { sectionId: 's1' });
  assert.equal(r.status, 'section');
});

test('orphaned: the section is gone', () => {
  const r = resolveAnchor('<section id="other"><p>x</p></section>', { sectionId: 's1', quote: { exact: 'brown fox' } });
  assert.equal(r.status, 'orphaned');
});

test('never throws / never loses a comment across the degradation ladder', () => {
  for (const html of [BASE, wrap('changed'), '<div>no sections</div>']) {
    const r = resolveAnchor(html, { sectionId: 's1', quote: { exact: 'brown fox' } });
    assert.ok(['precise', 'moved', 'section', 'orphaned'].includes(r.status));
  }
});

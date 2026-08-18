// The sortable table: a variant, not a second table component.
//
// Notion and Confluence both attach ordering to the table rather than
// introducing a block, and a second table component would split the vocabulary
// an author chooses from. The important property is what does NOT change: the
// authored order is canonical, so sorting is a view a reader asks for and never
// an edit to the document.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { component, needsOf, layerOf } from '../components/index.mjs';
import { buildBody, hidingRules } from '../lib/components-build.mjs';
import { specToMarkdown } from '../lib/html-to-md.mjs';

const ROWS = [['callout', 640], ['tag', 1298], ['panel', 97]];

const spec = (cls) => `<!DOCTYPE html>
<html lang="en" data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
<table class="${cls}"><thead><tr><th>Component</th><th>Uses</th></tr></thead>
<tbody>${ROWS.map(([n, u]) => `<tr><td>${n}</td><td>${u}</td></tr>`).join('')}</tbody></table>
</section></main></body></html>`;

const mdOf = (html) => {
  const out = specToMarkdown(html, { title: 'T' });
  return typeof out === 'string' ? out : (out.md || out.markdown || out.text);
};

test('sortable is interactive and needs the script', () => {
  const c = component('sortable');
  assert.ok(c);
  assert.equal(layerOf(c), 'interactive');
  assert.equal(needsOf(c), 'script');
  assert.equal(c.detect, 'table.sortable');
});

test('it is a variant of table, by selector', () => {
  // Named as the class that rides on a table rather than as a block of its own.
  assert.equal(component('sortable').selector, 'table.sortable');
  assert.ok(component('table'), 'and the table it rides on is still one component');
});

test('the rule gives the threshold and says the authored order still means something', () => {
  const { rule } = component('sortable');
  assert.match(rule, /ten or more/i, 'a threshold, not a vibe');
  assert.match(rule, /exports|order you write/i, 'and what sorting does not change');
});

test('it hides nothing, so it needs no live guard', () => {
  // Sorting reorders rows; it never removes them. That is why this component can
  // do without the [data-sf-live] gate the other enhanced ones need.
  assert.deepEqual(hidingRules(buildBody()), []);
  const css = buildBody();
  const own = css.split('\n').filter((l) => l.includes('table.sortable'));
  assert.ok(own.length, 'it has rules');
  assert.deepEqual(own.filter((l) => /display:\s*none|visibility:\s*hidden/.test(l)), []);
});

test('the markdown export is the authored order, not a sorted one', () => {
  // The export reads the file, and the file never moves. Stated as a test
  // because it is the property that makes offering a sort safe at all.
  const md = mdOf(spec('sortable'));
  assert.ok(md.indexOf('callout') < md.indexOf('tag'), 'callout first, as written');
  assert.ok(md.indexOf('tag') < md.indexOf('panel'), 'then tag, then panel');
});

test('a sortable table exports as an ordinary table', () => {
  // The class is a reading affordance, and markdown has no such concept. It must
  // not leak into the export as a marker nobody reads back.
  const sorted = mdOf(spec('sortable'));
  const plain = mdOf(spec(''));
  assert.equal(sorted, plain, 'the two exports are identical');
});

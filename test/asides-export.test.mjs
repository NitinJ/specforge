// What an aside does to the surfaces that were already there.
//
// The design's whole claim is that placing an aside next to its source section
// does the work filtering would have done. That claim is only true if the
// exporter needs no change, so this asserts it rather than trusting it.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specToMarkdown } from '../lib/html-to-md.mjs';
import { getSectionIds, getAsideSectionIds } from '../lib/spec.mjs';

const SPEC = `<!doctype html><html data-sf-spec-status="draft"><head><title>T</title></head><body>
<main>
  <h1>Export Spec</h1>
  <p class="sub">Spec · 2026-08-16 · status: <span>draft</span> · owner: nitin</p>
  <section id="one"><h2>1 · One</h2><p>The first section.</p></section>
  <section id="two"><h2>2 · Two</h2><p>The second section.</p></section>
  <section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize">
    <p>A diagram the agent drafted.</p>
  </section>
  <section id="three"><h2>3 · Three</h2><p>The third section.</p></section>
</main>
</body></html>`;

test('an aside exports in place, directly under the section it belongs to', () => {
  // Titled by the action that wrote it. The spec stores no heading on a draft,
  // because on screen the label comes from `data-sf-action` and a stored one put
  // the same words there twice. Markdown is flat and has no panel to title the
  // block, so the exporter derives it.
  const { markdown } = specToMarkdown(SPEC, { id: 'x', title: 'Export Spec' });
  const headings = [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(headings, ['1 · One', '2 · Two', 'Visualize', '3 · Three']);
});

test('a draft whose action the registry lost exports under its id', () => {
  // Never unlabelled: the id is at least true, where a guessed label is not.
  const { markdown } = specToMarkdown(
    SPEC.replace('data-sf-action="visualize"', 'data-sf-action="visualise"'),
    { id: 'x', title: 'Export Spec' },
  );
  const headings = [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(headings, ['1 · One', '2 · Two', 'two-aside-1', '3 · Three']);
});

test('the exporter needed no change: it walks sections in document order', () => {
  // The property the design rests on. If this ever stops being true, placement
  // stops doing the work and a filter has to be written after all.
  assert.deepEqual(
    getSectionIds(SPEC),
    ['one', 'two', 'two-aside-1', 'three'],
  );
});

test('an aside is findable as one, wherever its attributes sit', () => {
  assert.deepEqual(getAsideSectionIds(SPEC), ['two-aside-1']);
  const reordered = SPEC.replace(
    '<section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize">',
    '<section data-sf-action="visualize" data-sf-aside="two" id="two-aside-1">',
  );
  assert.deepEqual(getAsideSectionIds(reordered), ['two-aside-1']);
});

test('a spec with no asides reports none', () => {
  assert.deepEqual(getAsideSectionIds('<section id="one"><h2>One</h2></section>'), []);
});

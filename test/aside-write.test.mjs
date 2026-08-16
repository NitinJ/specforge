// `specforge aside`: the command that writes an aside into a spec.
//
// The skill telling an agent what markup to produce is prose, and the first real
// Visualize run proved it: the agent wrote its diagram straight into the section
// with no wrapper and no way to reject it. This is the mechanism that replaces
// the instruction. An agent that runs the command cannot get the attributes, the
// id or the placement wrong, because it does not write them.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10, stage 6.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAside } from '../lib/actions/write-aside.mjs';
import { getSectionIds, getAsideSectionIds } from '../lib/spec.mjs';

const SPEC = `<!doctype html><html><head><title>T</title></head><body>
<main>
  <h1>Spec</h1>
  <section id="one"><h2>1 · One</h2><p>First.</p></section>
  <section id="two"><h2>2 · Two</h2><p>Second.</p></section>
  <section id="three"><h2>3 · Three</h2><p>Third.</p></section>
</main>
</body></html>`;

const BODY = '<p>A diagram the agent drafted.</p>';

test('the aside lands directly after its source section', () => {
  const out = writeAside(SPEC, { section: 'two', action: 'visualize', body: BODY });
  assert.deepEqual(getSectionIds(out.html), ['one', 'two', 'two-aside-1', 'three']);
  assert.equal(out.id, 'two-aside-1');
});

test('it carries the attributes the review layer reads', () => {
  const { html } = writeAside(SPEC, { section: 'two', action: 'visualize', body: BODY });
  assert.match(html, /<section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize">/);
  assert.match(html, /<h3>Aside: Visualize<\/h3>/, 'the label, for the markdown export');
  assert.match(html, /A diagram the agent drafted/);
  assert.deepEqual(getAsideSectionIds(html), ['two-aside-1']);
});

test('a second aside on the same section counts up', () => {
  const first = writeAside(SPEC, { section: 'two', action: 'visualize', body: BODY });
  const second = writeAside(first.html, { section: 'two', action: 'go_deeper', body: '<p>More.</p>' });
  assert.equal(second.id, 'two-aside-2');
  assert.deepEqual(
    getSectionIds(second.html),
    ['one', 'two', 'two-aside-1', 'two-aside-2', 'three'],
    'stacked in the order they were run, both still before the next section',
  );
});

test('an unknown section is refused rather than guessed at', () => {
  assert.throws(
    () => writeAside(SPEC, { section: 'seven', action: 'visualize', body: BODY }),
    /seven/,
  );
});

test('an unknown action is refused', () => {
  assert.throws(
    () => writeAside(SPEC, { section: 'two', action: 'visualise', body: BODY }),
    /visualise/,
  );
});

test('an action that does not write an aside is refused', () => {
  // Tighten edits the section. An aside from it would be a draft nobody asked
  // for sitting beside prose that was supposed to be rewritten.
  assert.throws(
    () => writeAside(SPEC, { section: 'two', action: 'tighten', body: BODY }),
    /tighten/,
  );
});

test('an empty body is refused', () => {
  assert.throws(() => writeAside(SPEC, { section: 'two', action: 'visualize', body: '  ' }), /body/);
});

test('the source section is left exactly as it was', () => {
  // The failure this whole command exists to stop: an aside action editing the
  // thing it was supposed to leave alone.
  const { html } = writeAside(SPEC, { section: 'two', action: 'visualize', body: BODY });
  assert.match(html, /<section id="two"><h2>2 · Two<\/h2><p>Second\.<\/p><\/section>/);
});

test('a spec with no such attribute is unchanged apart from the insert', () => {
  const { html } = writeAside(SPEC, { section: 'three', action: 'explain_simply', body: BODY });
  assert.equal(html.indexOf('<section id="one">'), SPEC.indexOf('<section id="one">'));
  assert.match(html, /three-aside-1/);
  assert.deepEqual(getSectionIds(html), ['one', 'two', 'three', 'three-aside-1']);
});

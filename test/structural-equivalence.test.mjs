// The round-trip assertion is the contract the whole feature is judged against,
// so it gets its own tests: it must pass on the losses the design accepts and
// fail on everything else, naming the field that moved.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { fixture } from './fixtures/md/index.mjs';
import { assertStructurallyEquivalent, structuralModel, textOf } from './helpers/structural-equivalence.mjs';
import { useTempStore } from './helpers/temp-store.mjs';

const design = () => fixture('design').html();
const plan = () => fixture('design-impl').html();

test('a document is equivalent to itself', () => {
  assertStructurallyEquivalent(design(), design(), 'design');
  assertStructurallyEquivalent(plan(), plan(), 'design-impl');
});

test('accepted losses do not fail the assertion', () => {
  const before = design();
  const after = before
    // L5 whitespace
    .replace(/\n  <section/g, '\n\n\n<section')
    // L2 inline styles and attribute order
    .replace(/ style="[^"]*"/g, '')
    .replace(/<th>Attempt<\/th>/, '<th class="x" scope="col">Attempt</th>')
    // L1 tag classes: the text survives, the colour does not
    .replace(/<span class="tag warn">open<\/span>/, '<span>open</span>');
  assertStructurallyEquivalent(after, before, 'accepted losses');
});

// A tag's colour is an accepted loss because the text restates it. A notice's
// type is the only place the block's meaning is recorded, so losing it is a
// changed document. Before the exporter derived its list from the library, all
// 12 types came back as a bare callout and this assertion said nothing.
test('a changed notice type fails, naming the notice', () => {
  const before = design();
  const after = before.replace(/class="callout([^"]*)"/, 'class="callout note"');
  if (after === before) return; // the design fixture carries no notice
  assert.throws(
    () => assertStructurallyEquivalent(after, before, 'notice type'),
    /notices/,
  );
});

// The model has to pick the type the exporter picks, or a presentation class
// written before the type produces a false mismatch on a valid round trip.
test('a notice type is found whatever order its classes are written in', () => {
  const spec = (cls) => `<!DOCTYPE html><html data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
<div class="${cls}">The trigger, and the consequence.</div></section></main></body></html>`;
  assertStructurallyEquivalent(spec('callout compact risk'), spec('callout risk compact'), 'class order');
  assert.throws(
    () => assertStructurallyEquivalent(spec('callout compact note'), spec('callout risk compact'), 'type'),
    /notices/,
  );
});

test('a dropped notice type fails', () => {
  const one = '<div class="callout risk">The trigger, and the consequence.</div>';
  const spec = (body) => `<!DOCTYPE html><html data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>${body}</section></main></body></html>`;
  assert.throws(
    () => assertStructurallyEquivalent(spec(one.replace(' risk', '')), spec(one), 'dropped type'),
    /notices/,
  );
});

test('a reordered section fails, naming section order', () => {
  const before = plan();
  const a = before.match(/<section id="decisions"[\s\S]*?<\/section>/)[0];
  const b = before.match(/<section id="impl-plan"[\s\S]*?<\/section>/)[0];
  const after = before.replace(a, '@@A@@').replace(b, a).replace('@@A@@', b);
  assert.throws(() => assertStructurallyEquivalent(after, before), /section ids and order/);
});

test('a dropped section fails', () => {
  const before = design();
  const after = before.replace(/<section id="decisions"[\s\S]*?<\/section>/, '');
  assert.throws(() => assertStructurallyEquivalent(after, before), /section ids and order/);
});

test('a changed task status fails, naming the plan', () => {
  const before = plan();
  const after = before.replace('data-sf-task="1.2" data-sf-status="in_progress"', 'data-sf-task="1.2" data-sf-status="done"');
  assert.throws(() => assertStructurallyEquivalent(after, before), /plan \(stages, tasks, statuses\)/);
});

test('a changed table cell fails, naming the table', () => {
  const before = design();
  const after = before.replace('<td>900s</td>', '<td>901s</td>');
  assert.throws(() => assertStructurallyEquivalent(after, before), /tables\[0\]\.rows/);
});

test('a changed heading fails, naming the section', () => {
  const before = design();
  const after = before.replace('<h3>Classification</h3>', '<h3>Classifying</h3>');
  assert.throws(() => assertStructurallyEquivalent(after, before), /sections\[3\] \(#design\)\.headings/);
});

test('a lost code fence language fails', () => {
  const before = design();
  const after = before.replace('class="lang-js"', '');
  assert.throws(() => assertStructurallyEquivalent(after, before), /\.code/);
});

test('mangled code content fails, whitespace-sensitively', () => {
  const before = design();
  const after = before.replace('  const res = await post', 'const res = await post');
  assert.throws(() => assertStructurallyEquivalent(after, before), /\.code/);
});

test('a dropped diagram fails; an svg replaced by an equivalent image does not', () => {
  const before = fixture('diagrams').html();

  const dropped = before.replace(/<svg[\s\S]*?<\/svg>/, '');
  assert.throws(() => assertStructurallyEquivalent(dropped, before), /\.diagrams/);

  // What a real round trip does: the inline SVG leaves as a file and comes back
  // as an image. Same slot, same label, so this is equivalence, not a loss.
  const asImage = before.replace(
    /<svg\b[^>]*aria-label="([^"]*)"[\s\S]*?<\/svg>/g,
    (_m, label) => `<img src="spec.assets/d.svg" alt="${label}">`
  );
  assertStructurallyEquivalent(asImage, before, 'svg to image');
});

test('a dropped list item fails', () => {
  const before = design();
  const after = before.replace('<li>TLS handshake failure</li>', '');
  assert.throws(() => assertStructurallyEquivalent(after, before), /\.listItems/);
});

test('a flattened nested list fails: depth is part of the comparison', () => {
  const before = design();
  // Same items, same order, same text — only the hierarchy is gone. Comparing
  // item text alone would call this equivalent.
  const after = before.replace(
    /<li>A connection error, which covers:\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/,
    (_m, inner) => `<li>A connection error, which covers:</li>${inner}`
  );
  assert.notEqual(after, before, 'the flattening rewrite applied');
  assert.throws(() => assertStructurallyEquivalent(after, before), /\.listItems/);
});

test('an ordered list turned into an unordered one fails', () => {
  const before = fixture('research').html();
  const after = before.replace(/<ol>([\s\S]*?)<\/ol>/, '<ul>$1</ul>');
  assert.notEqual(after, before, 'the rewrite applied');
  assert.throws(() => assertStructurallyEquivalent(after, before), /\.listItems/);
});

test('the section title is compared by text, not by heading level', () => {
  const before = fixture('research').html();
  // The house TL;DR lives in an <h4> inside a panel. Markdown gives a section
  // exactly one heading, so it necessarily returns as the section's <h2>: that
  // is an accepted loss, and the text still has to match.
  const asH2 = before.replace('<h4 style="margin-top:0">TL;DR</h4>', '<h2>TL;DR</h2>');
  assertStructurallyEquivalent(asH2, before, 'title level');

  const renamed = before.replace('<h4 style="margin-top:0">TL;DR</h4>', '<h4 style="margin-top:0">Summary</h4>');
  assert.throws(() => assertStructurallyEquivalent(renamed, before), /the section title/);
});

test('a heading below the section title is still compared exactly', () => {
  const before = design();
  const after = before.replace('<h3>Classification</h3>', '<h4>Classification</h4>');
  assert.throws(() => assertStructurallyEquivalent(after, before), /headings \(below the title\)/);
});

test('the tracker is exempt: it is regenerated from the plan, not carried', () => {
  const before = plan();
  // Same plan, a rebuilt tracker: different heading, different rows. A round trip
  // that regenerates the tracker correctly must not fail on it.
  const after = before.replace(
    /<section id="task-tracker"[\s\S]*?<\/section>/,
    '<section id="task-tracker" data-sf-section><h2>Task tracker</h2><table><thead><tr><th>Stage</th></tr></thead><tbody><tr><td>rebuilt</td></tr></tbody></table></section>'
  );
  assertStructurallyEquivalent(after, before, 'derived tracker');

  // Losing it altogether is still a failure: it is a section, and it must be there.
  const dropped = before.replace(/<section id="task-tracker"[\s\S]*?<\/section>/, '');
  assert.throws(() => assertStructurallyEquivalent(dropped, before), /section ids and order/);
});

test('nesting depth is recorded, and plan tasks stay out of it', () => {
  const designSection = structuralModel(design()).sections.find((s) => s.id === 'design');
  assert.deepEqual(
    designSection.listItems.filter((i) => i.depth === 1).map((i) => i.text),
    ['DNS failure', 'TLS handshake failure', 'Read timeout past 10s']
  );
  const planSection = structuralModel(plan()).sections.find((s) => s.id === 'impl-plan');
  assert.deepEqual(planSection.listItems, [], 'tasks are compared by id and status, not as list text');
});

test('a changed title or status fails', () => {
  const before = design();
  // getTitle() reads <title> and only falls back to <h1>, so each is checked on
  // its own: a document with two different titles is not a clean round trip.
  assert.throws(
    () => assertStructurallyEquivalent(before.replace('<h1>Retry policy for webhook delivery</h1>', '<h1>Retries</h1>'), before),
    /h1 \(the on-page title\)/
  );
  assert.throws(
    () => assertStructurallyEquivalent(before.replace('<title>Retry policy for webhook delivery — Spec</title>', '<title>Retries — Spec</title>'), before),
    /title/
  );
  assert.throws(
    () => assertStructurallyEquivalent(before.replace('data-sf-spec-status="draft"', 'data-sf-spec-status="approved"'), before),
    /status/
  );
});

test('textOf decodes entities and collapses whitespace', () => {
  assert.equal(textOf('<p>a &amp; b\n   c</p>'), 'a & b c');
  assert.equal(textOf('<code>&lt;section&gt;</code>'), '<section>');
  assert.equal(textOf('&amp;lt;'), '&lt;', 'ampersand decodes last, so this stays escaped');
});

test('the model exposes the fields the failure messages name', () => {
  const m = structuralModel(plan());
  assert.ok(m.sectionIds.includes('impl-plan'));
  assert.equal(m.plan[0].pr, '311', 'a stage PR number is part of the model');
  assert.deepEqual(
    m.plan[1].tasks.map((t) => t.status),
    ['done', 'in_progress', 'blocked', 'deferred']
  );
});

const store = useTempStore({ beforeEach, afterEach }, 'sf-helper-');

test('useTempStore points SPECFORGE_HOME at a fresh directory', () => {
  assert.equal(process.env.SPECFORGE_HOME, store.dir);
  assert.ok(existsSync(store.dir));
});

test('and rebinds it per test rather than reusing the first one', () => {
  assert.equal(process.env.SPECFORGE_HOME, store.dir);
  assert.ok(existsSync(store.dir));
});

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

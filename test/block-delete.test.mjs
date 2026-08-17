// Deleting one block of a spec.
//
// The second place the browser removes something, and unlike an aside this is
// the reader's own writing. So the identification has to be exact, and anything
// short of exact has to refuse rather than guess: cutting the wrong paragraph is
// worse than not cutting one, and nothing in the store is versioned.
//
// The client cannot say "block 7": what counts as a commentable block is decided
// in the browser, from a selector that includes injected component classes,
// excludes review chrome, and collapses a rendered diagram to the <pre> it came
// from. None of that is knowable here. So the client names the block the way a
// reader would — this tag, in this section, with this text — and the server
// finds exactly one match or refuses.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteBlock } from '../lib/actions/delete-block.mjs';

const SPEC = `<main>
  <section id="one">
    <h2>1 · One</h2>
    <p>The first paragraph.</p>
    <p>The second paragraph.</p>
    <ul><li>A list item.</li><li>Another item.</li></ul>
    <figure><img alt="d"><figcaption>A figure.</figcaption></figure>
  </section>
  <section id="two">
    <h2>2 · Two</h2>
    <p>The first paragraph.</p>
  </section>
</main>`;

const cut = (html, opts) => deleteBlock(html, opts);

test('the named block goes and nothing else moves', () => {
  const out = cut(SPEC, { section: 'one', tag: 'P', text: 'The second paragraph.' });
  assert.equal(out.html.includes('The second paragraph.'), false);
  assert.equal(out.html.includes('The first paragraph.'), true);
  assert.equal(out.html.includes('A list item.'), true);
  assert.equal(out.section, 'one');
});

test('the same text in another section is not touched', () => {
  // "The first paragraph." appears in both sections. The section is part of the
  // identification precisely so this is unambiguous.
  const out = cut(SPEC, { section: 'two', tag: 'P', text: 'The first paragraph.' });
  const one = out.html.slice(out.html.indexOf('id="one"'), out.html.indexOf('id="two"'));
  assert.equal(one.includes('The first paragraph.'), true, 'section one keeps its copy');
  const two = out.html.slice(out.html.indexOf('id="two"'));
  assert.equal(two.includes('The first paragraph.'), false, 'section two loses its own');
});

test('a block holding other elements is removed whole', () => {
  const out = cut(SPEC, { section: 'one', tag: 'FIGURE', text: 'A figure.' });
  assert.equal(out.html.includes('<figure'), false);
  assert.equal(out.html.includes('figcaption'), false, 'its children went with it');
  assert.equal(out.html.includes('A list item.'), true);
});

test('a list item is a block of its own', () => {
  const out = cut(SPEC, { section: 'one', tag: 'LI', text: 'A list item.' });
  assert.equal(out.html.includes('A list item.'), false);
  assert.equal(out.html.includes('Another item.'), true, 'the list survives');
});

test('text that matches nothing is refused', () => {
  // The document moved under the client: an agent rewrote the paragraph between
  // the page loading and the reader clicking. Deleting whatever is nearest would
  // remove something they never looked at.
  assert.throws(
    () => cut(SPEC, { section: 'one', tag: 'P', text: 'A paragraph that is not there.' }),
    /no block/,
  );
});

test('text that matches twice is refused rather than resolved by position', () => {
  // Two identical paragraphs in one section. Picking the first is a coin flip
  // the reader cannot see, and they are equally likely to have meant the other.
  const twice = SPEC.replace('<p>The second paragraph.</p>', '<p>The first paragraph.</p>');
  assert.throws(
    () => cut(twice, { section: 'one', tag: 'P', text: 'The first paragraph.' }),
    /matches 2 blocks/,
  );
});

test('the tag has to match too', () => {
  // The heading and a paragraph could carry the same words; the reader pointed
  // at one of them.
  assert.throws(
    () => cut(SPEC, { section: 'one', tag: 'H3', text: 'The first paragraph.' }),
    /no block/,
  );
});

test('an unknown section is refused', () => {
  assert.throws(() => cut(SPEC, { section: 'nope', tag: 'P', text: 'x' }), /no section/);
});

test('whitespace in the document does not have to match the text given', () => {
  // The client sends normalised text, because that is what it can see; the
  // document has newlines and indentation the reader never typed.
  const wrapped = SPEC.replace(
    '<p>The second paragraph.</p>',
    '<p>\n      The second\n      paragraph.\n    </p>',
  );
  const out = cut(wrapped, { section: 'one', tag: 'P', text: 'The second paragraph.' });
  assert.equal(out.html.includes('The second'), false);
});

test('markup inside the block does not have to be in the text given', () => {
  // The reader sees "A bold claim", not "A <strong>bold</strong> claim".
  const rich = SPEC.replace('<p>The second paragraph.</p>', '<p>A <strong>bold</strong> claim.</p>');
  const out = cut(rich, { section: 'one', tag: 'P', text: 'A bold claim.' });
  assert.equal(out.html.includes('bold'), false);
});

// The three ways the client's view and the file's text disagree. Each of them
// made Delete answer 409 on a block nobody had touched, which reads to the
// reader as "this is broken" and is indistinguishable from a genuinely stale
// page.

test('an entity in the source matches the character the reader sees', () => {
  // textContent is decoded and the file is not, so a paragraph holding `&amp;`
  // or an `&#8212;` never matched. SpecForge's own templates write the numeric
  // forms, so this was most of the em dashes in every spec it produces.
  const withEntities = SPEC.replace(
    '<p>The second paragraph.</p>',
    '<p>Fish &amp; chips &#8212; a classic&#8230;</p>',
  );
  const out = cut(withEntities, { section: 'one', tag: 'P', text: 'Fish & chips — a classic…' });
  assert.equal(out.html.includes('Fish'), false);
});

test('a hex entity decodes in either case, on both the x and the digits', () => {
  // Case is significant for a name and not for a hex reference. Sharing one
  // regex flag between the two branches got this wrong in both directions.
  for (const spelling of ['&#x2014;', '&#X2014;', '&#x201C;', '&#X201c;']) {
    const hex = SPEC.replace('<p>The second paragraph.</p>', `<p>A ${spelling} mark.</p>`);
    const want = `A ${spelling === '&#x2014;' || spelling === '&#X2014;' ? '—' : '“'} mark.`;
    const out = cut(hex, { section: 'one', tag: 'P', text: want });
    assert.equal(out.html.includes('mark'), false, `${spelling} did not decode`);
  }
});

test('a valid entity the decoder does not carry still matches', () => {
  // The table is finite and the set of named entities is not, so `&copy;` in a
  // spec would leave an untouched block undeletable. An unrecognised entity is
  // matched as one character, because that is what it is.
  const c = SPEC.replace('<p>The second paragraph.</p>', '<p>&copy; 2026 Figur.</p>');
  const out = cut(c, { section: 'one', tag: 'P', text: '© 2026 Figur.' });
  assert.equal(out.html.includes('2026'), false);
});

test('two entities that decode differently are two different blocks', () => {
  // The comparison is exact, and this is why. A single-character wildcard for an
  // unknown entity made these two look alike, so a request written before
  // someone changed one to the other still matched and deleted a block the
  // reader had never seen.
  const two = SPEC
    .replace('<p>The first paragraph.</p>', '<p>Figur &copy; here.</p>')
    .replace('<p>The second paragraph.</p>', '<p>Figur &reg; here.</p>');
  const out = cut(two, { section: 'one', tag: 'P', text: 'Figur © here.' });
  assert.equal(out.html.includes('&copy;'), false, 'the one that was asked for');
  assert.equal(out.html.includes('&reg;'), true, 'and not the other');
});

test('text that is simply different does not match', () => {
  const c = SPEC.replace('<p>The second paragraph.</p>', '<p>&copy; 2026 Figur.</p>');
  assert.throws(() => cut(c, { section: 'one', tag: 'P', text: '© 2027 Figur.' }), /no block/);
});

test('case tells two named entities apart', () => {
  // &Alpha; and &alpha; are different characters, so the table is read
  // case-sensitively even though the numeric forms are not.
  const g = SPEC.replace('<p>The second paragraph.</p>', '<p>&Alpha; and &alpha;.</p>');
  const out = cut(g, { section: 'one', tag: 'P', text: 'Α and α.' });
  assert.equal(out.html.includes('Alpha'), false);
});

test('a component block is a div, and deletes like anything else', () => {
  // Half the commentable surfaces are components: .panel, .callout, .card and
  // the injected component classes, every one of them a div. A whitelist of the
  // plain block tags refused a delete on exactly the entries most likely to be
  // deleted.
  const withCallout = SPEC.replace(
    '<p>The second paragraph.</p>',
    '<div class="callout note"><strong>Note.</strong> Worth knowing.</div>',
  );
  const out = cut(withCallout, { section: 'one', tag: 'DIV', text: 'Note. Worth knowing.' });
  assert.equal(out.html.includes('callout'), false);
  assert.equal(out.html.includes('The first paragraph.'), true);
});

test('a tag that holds the document is refused whatever the text says', () => {
  // A section cannot be taken out through the route meant for its contents.
  for (const tag of ['SECTION', 'MAIN', 'BODY', 'SCRIPT']) {
    assert.throws(() => cut(SPEC, { section: 'one', tag, text: 'anything' }), /holds the document/);
  }
});

test('a tag that is not a tag name is refused', () => {
  assert.throws(() => cut(SPEC, { section: 'one', tag: 'p, li', text: 'x' }), /not a tag name/);
  assert.throws(() => cut(SPEC, { section: 'one', tag: '', text: 'x' }), /not a tag name/);
});

test('a diagram is found by its source, which is what the file holds', () => {
  // The rendered picture replaced its own source in the DOM, so the client sends
  // the source it stashed and the server searches the same thing.
  const withDiagram = SPEC.replace(
    '<p>The second paragraph.</p>',
    '<pre data-lang="mermaid"><code>graph TD\n  A--&gt;B</code></pre>',
  );
  const out = cut(withDiagram, { section: 'one', tag: 'PRE', text: 'graph TD A-->B' });
  assert.equal(out.html.includes('graph TD'), false);
});

test('an aside is refused: it has its own delete', () => {
  // Cutting one block out of a draft leaves a half-answered draft, and the
  // reader already has a control that removes the whole thing.
  const withAside = SPEC.replace(
    '<section id="two">',
    '<section id="one-aside-1" data-sf-aside="one" data-sf-action="visualize">'
    + '<p>A diagram.</p></section><section id="two">',
  );
  assert.throws(
    () => cut(withAside, { section: 'one-aside-1', tag: 'P', text: 'A diagram.' }),
    /draft/,
  );
});

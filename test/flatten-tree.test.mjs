// Flattening a subtree into one document.
//
// Two consumers, one builder: printing a parent, and exporting it to Google
// Docs. Both want the whole thing as a single document, because both leave
// SpecForge, and a Doc has no folder.
//
// The rule that has to hold is unique section ids. Two specs both carrying a
// `tldr` section would give the flattened document two elements with the same
// id, which silently breaks every anchor link in it.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { poison, unpoisonAll, needsPoison } from './helpers/fs-probe.mjs';
import { flattenSubtree } from '../lib/flatten-tree.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-flat-');
afterEach(() => unpoisonAll());

const doc = (html) => new JSDOM(html).window.document;

/**
 * A spec whose body carries the given sections.
 *
 * `created` is explicit and increasing, because siblings are ordered by it and
 * two specs seeded in the same millisecond tie: an earlier version of the
 * ordering test below passed or failed on the clock.
 */
let clock = 1000;
function specWith(title, sectionIds, parent = null) {
  const sections = sectionIds
    .map((sid) => `<section id="${sid}"><h2>${sid}</h2><p>Body of ${sid} in ${title}.</p></section>`)
    .join('');
  clock += 1000;
  return seedSpec({
    title,
    parent,
    created: clock,
    html: `<!DOCTYPE html><html><head><title>${title}</title>`
      + '<style>body{color:#123456}</style></head>'
      + `<body><h1>${title}</h1>${sections}</body></html>`,
  });
}

test('a leaf flattens to its own document', () => {
  const id = specWith('Alone', ['tldr', 'design']);
  const d = doc(flattenSubtree(id));
  assert.match(d.querySelector('h1').textContent, /Alone/);
  assert.ok(d.querySelector('#tldr'), 'the root keeps its own section ids');
});

test('a subtree flattens into one document carrying every descendant', () => {
  const root = specWith('Root', ['tldr']);
  const a = specWith('Child A', ['tldr'], root);
  const grand = specWith('Grandchild', ['tldr'], a);

  const d = doc(flattenSubtree(root));
  const text = d.body.textContent;
  for (const title of ['Root', 'Child A', 'Grandchild']) {
    assert.match(text, new RegExp(title), `${title} is missing from the flattened document`);
  }
  void grand;
});

test('descendants appear in depth-first order, after the root', () => {
  const root = specWith('Root', ['tldr']);
  const a = specWith('A', ['tldr'], root);
  specWith('A child', ['tldr'], a);
  specWith('B', ['tldr'], root);

  const heads = Array.prototype.map.call(
    doc(flattenSubtree(root)).querySelectorAll('h1'),
    (el) => el.textContent.trim(),
  );
  assert.deepEqual(heads, ['Root', 'A', 'A child', 'B']);
});

test("a spec's title is not printed twice", () => {
  const root = specWith('Root', ['tldr']);
  specWith('A', ['tldr'], root);

  const d = doc(flattenSubtree(root));
  const titles = Array.prototype.map.call(
    d.querySelectorAll('h1, .sf-flat-title'),
    (el) => el.textContent.trim(),
  );
  assert.deepEqual(titles, ['Root', 'A'], 'the wrapper duplicated a heading the spec already had');
});

test('a spec with no heading of its own gets one, so its section is identifiable', () => {
  const root = specWith('Root', ['tldr']);
  const bare = seedSpec({
    title: 'Headless child',
    parent: root,
    html: '<html><body><p>No heading at all.</p></body></html>',
  });

  const d = doc(flattenSubtree(root));
  const wrapper = d.querySelector(`[id="${bare}"] .sf-flat-title`);
  assert.ok(wrapper, 'a spec with no h1 must still be labelled');
  assert.match(wrapper.textContent, /Headless child/);
});

test('every section id in the flattened document is unique', () => {
  const root = specWith('Root', ['tldr', 'design', 'decisions']);
  const a = specWith('A', ['tldr', 'design'], root);
  specWith('B', ['tldr', 'design'], root);

  const ids = Array.prototype.map.call(doc(flattenSubtree(root)).querySelectorAll('[id]'), (el) => el.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
});

test("a descendant's ids are prefixed with its spec id, and the root's are not", () => {
  const root = specWith('Root', ['tldr']);
  const a = specWith('A', ['tldr'], root);

  const d = doc(flattenSubtree(root));
  // Attribute selectors, not `#id`: a spec id is hex and can start with a digit,
  // which is a valid HTML id and an invalid CSS selector. An earlier version of
  // this test passed or failed depending on the random id it got.
  assert.ok(d.querySelector('[id="tldr"]'), "the root's own ids should be untouched");
  assert.ok(d.querySelector(`[id="${a}-tldr"]`), "a descendant's ids should carry its spec id");
});

test('links to a moved id are rewritten to follow it', () => {
  const root = seedSpec({ title: 'Root', html: '<html><body><h1>Root</h1><section id="tldr">r</section></body></html>' });
  seedSpec({
    title: 'A',
    parent: root,
    html: '<html><body><h1>A</h1><section id="tldr">a</section>'
      + '<p><a href="#tldr">up to my own tldr</a></p></body></html>',
  });

  const d = doc(flattenSubtree(root));
  const hrefs = Array.prototype.map.call(d.querySelectorAll('a[href^="#"]'), (el) => el.getAttribute('href'));
  // An anchor inside a descendant meant that descendant's section, and it has
  // to keep meaning it once both documents are in one.
  assert.ok(hrefs.every((h) => h !== '#tldr'), `an anchor was left pointing at the root: ${hrefs}`);
});

test('the style block comes from the root', () => {
  const root = specWith('Root', ['tldr']);
  specWith('A', ['tldr'], root);
  const html = flattenSubtree(root);
  assert.match(html, /color:#123456/);
});

test('a descendant that cannot be read leaves a labelled gap, not a failure', needsPoison, () => {
  const root = specWith('Root', ['tldr']);
  const a = specWith('A', ['tldr'], root);
  specWith('B', ['tldr'], root);

  poison(specHtmlPath(a));
  const html = flattenSubtree(root);

  // One unreadable descendant must not cost the whole print or export.
  assert.match(html, /Root/);
  assert.match(html, /B/);
  assert.match(html, new RegExp(a), 'the gap should name the spec that is missing');
  assert.match(html, /could not be read/i);
});

test('flattening an unknown spec throws rather than returning an empty document', () => {
  assert.throws(() => flattenSubtree('0000000000'), /unknown spec/i);
});

test('a cycle in stored data terminates', () => {
  const { ids } = buildShape('cyclic');
  const html = flattenSubtree(ids[0]);
  assert.ok(html.length > 0);
});

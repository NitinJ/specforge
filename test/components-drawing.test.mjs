// The guidance an authoring agent reads before drawing anything.
//
// The component library's whole thesis is that a rule living apart from the
// thing it governs goes stale. Three ways to draw is a comparison between
// components rather than a property of one, so it is generated from a single
// place and checked here: an agent that reads only the generated file must be
// able to pick correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COMPONENTS, componentClasses, blockComponents } from '../components/index.mjs';
import { buildRules } from '../lib/components-rules.mjs';
import { buildCss } from '../lib/components-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = () => buildRules();

test('mermaid is in the library, as an element with the selector an author writes', () => {
  const c = COMPONENTS.find((x) => x.name === 'mermaid');
  assert.ok(c, 'the library knows about it');
  assert.equal(c.family, 'structure');
  assert.equal(c.kind, 'element');
  assert.equal(c.selector, 'pre[data-lang="mermaid"]');
  assert.ok(c.block, 'and it is a comment target');
});

// The marker is the declared language, which three existing mechanisms already
// read. Adding a class would have meant a fourth thing to keep in step.
test('it adds no class and no stamped CSS', () => {
  assert.ok(!componentClasses().includes('mermaid'), 'not a class the lint checks for');
  assert.ok(!blockComponents().includes('mermaid'), 'and not appended to BLOCK_SEL: <pre> is already there');
  assert.doesNotMatch(buildCss(), /data-sf-mermaid/,
    'the paint lives in review.css, because a diagram only exists where the review layer does');
});

test('the generated rules tell an author how to choose between all three', () => {
  const md = rules();
  assert.match(md, /^## Drawing$/m, 'the choice has its own section');
  for (const use of ['pre[data-lang="mermaid"]', '`.flow`', 'inline SVG', '`table`']) {
    assert.ok(md.includes(use), `the section names ${use}`);
  }
  // Each option needs a reason, or an author picks the most powerful one every
  // time. The table's third column is that reason.
  assert.match(md, /\| If the diagram is \| Use \| Because \|/, 'and says why, not only which');
});

test('the rules name the limits an author would otherwise hit', () => {
  const md = rules();
  assert.match(md, /15 nodes/, 'the size past which a diagram stops being readable');
  assert.match(md, /one comment target/, 'a diagram is commented on as a whole');
  assert.match(md, /file:\/\//, 'and what a reader sees without the review layer');
});

// The two rules about declaring a language would read as contradictory if the
// exception were left implicit: "declare the language on code" and "do not
// declare one on a block that is not code", with a diagram being neither.
test('house-rules names mermaid as the exception to its own language rule', () => {
  const house = readFileSync(join(ROOT, 'templates', 'house-rules.md'), 'utf8');
  const codeAt = house.indexOf('## Code blocks');
  const diagramsAt = house.indexOf('## Diagrams');
  assert.ok(codeAt > 0 && diagramsAt > 0, 'both sections exist');

  const codeSection = house.slice(codeAt, house.indexOf('\n## ', codeAt + 4));
  assert.match(codeSection, /mermaid` is the one exception/,
    'the code-block rule names the exception rather than leaving it to be inferred');
  assert.match(codeSection, /ASCII sketch stays undeclared/,
    'and says the original rule is otherwise unchanged');
});

test('house-rules carries the three-way choice and points at the full rule', () => {
  const house = readFileSync(join(ROOT, 'templates', 'house-rules.md'), 'utf8');
  const section = house.slice(house.indexOf('## Diagrams'), house.indexOf('## Naming'));
  assert.match(section, /pre data-lang="mermaid"/);
  assert.match(section, /\.flow/);
  assert.match(section, /references\/spec-components\.md/, 'points at the generated rule');
  assert.match(section, /one comment target/);
});

test('references/spec-components.md on disk is what the generator produces', () => {
  const onDisk = readFileSync(join(ROOT, 'references', 'spec-components.md'), 'utf8');
  assert.equal(onDisk, rules(), 'run `components build` and commit the result');
});

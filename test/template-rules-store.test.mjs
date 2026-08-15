// Template rules and prompts, end to end through the store.
//
// The claim under test: a spec created from a template carries neither block,
// the rest of the document matches the template, and the prompts the strip
// removed come back to the caller so the guidance still reaches the agent.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { ensureTemplates, templateHtmlFor, templateRules, templatePrompts, templateId } from '../lib/store-templates.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { hasTemplateBlocks, stripTemplateBlocks } from '../lib/rules/template-blocks.mjs';
import { allRules } from '../lib/rules/all.mjs';
import { cmdCreate, cmdImport } from '../lib/specforge-cli.mjs';
import { SPEC_TYPES } from '../lib/meta.mjs';
import { TEMPLATE_RULES } from '../lib/rules/template-defaults.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-template-rules-');

const deps = { ensureDaemon: async () => ({ url: 'http://localhost:4180' }), session: '' };

test('every bundled shell arrives carrying its type its own rules', () => {
  for (const type of SPEC_TYPES) {
    const html = templateHtmlFor(type);
    assert.equal(hasTemplateBlocks(html), true, `${type} has no blocks`);
    const ids = templateRules(type).map((r) => r.id);
    assert.deepEqual(ids, TEMPLATE_RULES[type].map((r) => r.id), type);
  }
});

// A prompt attaches to a section, so a shell without that section gets no
// prompt. `general` is a bare scaffold and `deck` is slides; neither has open
// questions or decisions, and inventing a place to put the guidance would be
// worse than leaving it out. `research` has open questions but no decisions
// table.
const PROMPTED_SECTIONS = {
  design: ['decisions', 'open-questions'],
  'design-impl': ['decisions', 'open-questions'],
  impl: ['decisions', 'open-questions'],
  research: ['open-questions'],
  general: [],
  deck: [],
};

test('a prompt lands in every section that exists to carry one, and nowhere else', () => {
  for (const type of SPEC_TYPES) {
    const sections = templatePrompts(type).map((p) => p.section).sort();
    assert.deepEqual(sections, PROMPTED_SECTIONS[type], type);
  }
});

test('the two sections the corpus is about do carry the guidance', () => {
  const openQ = templatePrompts('design').find((p) => p.section === 'open-questions');
  assert.match(openQ.text, /genuine fork/);
  assert.match(openQ.text, /plain words/);
  assert.match(openQ.text, /Never leave a question open ended/);
  const dec = templatePrompts('design').find((p) => p.section === 'decisions');
  assert.match(dec.text, /what the choice costs/);
});

test('allRules layers the template onto the global floor', () => {
  const design = allRules('design').map((r) => r.id);
  assert.ok(design.includes('no-placeholders'), 'the global floor is still there');
  assert.ok(design.includes('no-build-plan'), "the type's own rule is added");
  assert.equal(design.includes('plan-is-the-bulk'), false, "another type's rule is not");
});

test('allRules honours the deck override, which is the case the mechanism exists for', () => {
  assert.equal(allRules('deck').some((r) => r.id === 'no-aphorisms'), false);
  assert.equal(allRules('design').some((r) => r.id === 'no-aphorisms'), true);
});

test('allRules gives the impl types the corpus rules moved by D12', () => {
  for (const type of ['design-impl', 'impl']) {
    const ids = allRules(type).map((r) => r.id);
    assert.ok(ids.includes('stages-are-explained-plainly'), type);
    assert.ok(ids.includes('fixes-carry-a-guard'), type);
  }
  assert.ok(allRules('research').map((r) => r.id).includes('findings-name-what-they-break'));
  assert.equal(allRules('design').map((r) => r.id).includes('stages-are-explained-plainly'), false);
});

test('a created spec carries neither block, whatever its type', async () => {
  for (const type of SPEC_TYPES) {
    const { id, htmlPath, prompts } = await cmdCreate({ title: `A ${type} spec`, type }, deps);
    const html = readFileSync(htmlPath, 'utf8');
    assert.equal(hasTemplateBlocks(html), false, `${type}: a spec must never carry the scaffolding`);
    assert.deepEqual(prompts.map((p) => p.section).sort(), PROMPTED_SECTIONS[type], type);
    assert.ok(id);
  }
});

test('a created spec is its template with the blocks removed and nothing else', async () => {
  const { htmlPath } = await cmdCreate({ title: 'Compared', type: 'design' }, deps);
  const created = readFileSync(htmlPath, 'utf8');
  // create stamps the component version on some types, so compare against the
  // template put through the same strip rather than against the raw shell.
  assert.equal(created, stripTemplateBlocks(templateHtmlFor('design')));
});

test('what create returns is what it stripped', async () => {
  const { prompts } = await cmdCreate({ title: 'Prompted', type: 'design' }, deps);
  assert.deepEqual(prompts.map((p) => p.section).sort(), ['decisions', 'open-questions']);
  assert.match(prompts.find((p) => p.section === 'open-questions').text, /genuine fork/);
  assert.match(prompts.find((p) => p.section === 'decisions').text, /what the choice costs/);
});

test('editing a store template changes what the next spec is judged against', () => {
  ensureTemplates();
  const id = templateId('design');
  const edited = templateHtmlFor('design').replace(
    '<li data-sf-rule="no-build-plan"',
    '<li data-sf-rule="house-style" data-sf-severity="advisory">Follow the house style.</li>\n    <li data-sf-rule="no-build-plan"',
  );
  writeFileSync(specHtmlPath(id), edited);
  const ids = allRules('design').map((r) => r.id);
  assert.ok(ids.includes('house-style'), 'a rule written into the template is a rule');
  assert.equal(allRules('design').find((r) => r.id === 'house-style').severity, 'advisory');
});

test('emptying a template’s rules block falls back to the global list alone', () => {
  ensureTemplates();
  const id = templateId('design');
  writeFileSync(specHtmlPath(id), stripTemplateBlocks(templateHtmlFor('design')));
  assert.deepEqual(templateRules('design'), []);
  const ids = allRules('design').map((r) => r.id);
  assert.equal(ids.includes('no-build-plan'), false);
  assert.ok(ids.includes('no-placeholders'), 'the global list is the floor');
});

test('a template can turn a global rule off by id and nothing else changes', () => {
  ensureTemplates();
  const id = templateId('design');
  const edited = templateHtmlFor('design').replace(
    '<li data-sf-rule="no-build-plan"',
    '<li data-sf-rule="costs-are-stated" data-sf-severity="off"></li>\n    <li data-sf-rule="no-build-plan"',
  );
  writeFileSync(specHtmlPath(id), edited);
  const ids = allRules('design').map((r) => r.id);
  assert.equal(ids.includes('costs-are-stated'), false);
  assert.ok(ids.includes('rejections-are-real'), 'the rules either side are untouched');
});

test('importing a file that carries a rules block does not smuggle it into the spec', async () => {
  const src = `${process.env.SPECFORGE_HOME}/carrier.html`;
  writeFileSync(src, `<body><section id="a"><h2>A</h2><p>x</p></section>
<section data-sf-rules hidden><ul><li data-sf-rule="sneaky">Should not survive.</li></ul></section>
</body>`);
  const { htmlPath } = await cmdImport({ file: src, title: 'Imported', type: 'design' }, deps);
  assert.equal(hasTemplateBlocks(readFileSync(htmlPath, 'utf8')), false);
});

test('the seeded store template is what the bundled shell renders', () => {
  ensureTemplates();
  for (const type of SPEC_TYPES) {
    const stored = readFileSync(specHtmlPath(templateId(type)), 'utf8');
    assert.equal(hasTemplateBlocks(stored), true, `${type}: the seeded template lost its blocks`);
  }
});

test('reseeding never overwrites an edited template', () => {
  ensureTemplates();
  const id = templateId('design');
  writeFileSync(specHtmlPath(id), '<body><p>Mine now.</p></body>');
  ensureTemplates();
  assert.equal(readFileSync(specHtmlPath(id), 'utf8'), '<body><p>Mine now.</p></body>');
});

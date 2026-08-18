// What the Sections and Rules tabs read and write.
//
// These two classes live in the template specs, not in prompts.json, so the
// property this suite defends is that the pane edits the blocks and nothing
// else: a template is also a spec somebody edits by hand, and its shell belongs
// to them. The other is that shipped rules cannot be removed through this API
// however wrong the page's request is (D9).
//
// Task 4.1.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import {
  handleTemplateBlocksGet, handleTemplateBlocksPut, handleTemplateBlocksReset,
} from '../lib/template-blocks-api.mjs';
import { templateRules, templatePrompts, templateId } from '../lib/store-templates.mjs';
import { TEMPLATE_RULES } from '../lib/rules/template-defaults.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-tb-');

const custom = (over = {}) => ({ id: 'no_vendor_quotes', ask: 'No vendor quotes.', fix: 'Cut it.', ...over });

test('a type reports its shipped rules, marked as shipped', () => {
  const s = handleTemplateBlocksGet('research');
  assert.equal(s.rules.length, TEMPLATE_RULES.research.length);
  assert.equal(s.rules.every((r) => r.shipped), true);
});

test('the type list travels, so the picker need not hardcode it', () => {
  const s = handleTemplateBlocksGet('design');
  assert.ok(s.types.includes('design-impl'));
  assert.ok(s.types.includes('deck'));
});

test('a custom rule round-trips through the template block', () => {
  handleTemplateBlocksPut('design', { rules: [custom()], prompts: [] });
  const after = handleTemplateBlocksGet('design');
  const mine = after.rules.find((r) => r.id === 'no_vendor_quotes');
  assert.ok(mine, 'it is in the effective list');
  assert.equal(mine.shipped, false);
  assert.equal(templateRules('design').some((r) => r.id === 'no_vendor_quotes'), true,
    'and verify reads it from the template, which is the point');
});

test('shipped rules survive a put that omits them', () => {
  // The page sends what it has; the API re-attaches the shipped set rather than
  // trusting it, so a page bug cannot delete the floor under every spec.
  handleTemplateBlocksPut('research', { rules: [], prompts: [] });
  const after = handleTemplateBlocksGet('research');
  assert.equal(after.rules.filter((r) => r.shipped).length, TEMPLATE_RULES.research.length);
});

test('a put cannot overwrite a shipped rule by reusing its id', () => {
  const target = TEMPLATE_RULES.research[0].id;
  handleTemplateBlocksPut('research', {
    rules: [{ id: target, ask: 'Something else entirely.' }],
    prompts: [],
  });
  const after = handleTemplateBlocksGet('research');
  const same = after.rules.filter((r) => r.id === target);
  assert.equal(same.length, 1, 'no duplicate');
  assert.equal(same[0].ask, TEMPLATE_RULES.research[0].ask, 'and the shipped wording stands');
});

test('a rule with no ask is dropped rather than stored empty', () => {
  handleTemplateBlocksPut('design', { rules: [custom({ ask: '   ' })], prompts: [] });
  assert.equal(handleTemplateBlocksGet('design').rules.some((r) => !r.shipped), false);
});

test('a prompt round-trips and reaches templatePrompts', () => {
  handleTemplateBlocksPut('design', { rules: [], prompts: [{ section: 'design', text: 'Lead with the diagram.' }] });
  const got = templatePrompts('design').find((p) => p.section === 'design');
  assert.ok(got);
  assert.match(got.text, /Lead with the diagram/);
});

test('an untouched shipped prompt reads as default, not customized', () => {
  // A prompt is rendered into the template as one <p> per paragraph and parsed
  // back as joined text, so a byte comparison against the shipped constant
  // always differs and every row read as customized. Found by looking at the
  // rendered tab, not by a test.
  const s = handleTemplateBlocksGet('design-impl');
  const shipped = s.prompts.filter((p) => p.shipped);
  assert.ok(shipped.length >= 2, 'design-impl ships prompts');
  assert.equal(shipped.every((p) => !p.customized), true,
    'nothing has been edited, so nothing claims to have been');
});

test('an edited shipped prompt does read as customized', () => {
  handleTemplateBlocksPut('design-impl', {
    rules: [],
    prompts: [{ section: 'decisions', text: 'Name the option not taken.' }],
  });
  const got = handleTemplateBlocksGet('design-impl').prompts.find((p) => p.section === 'decisions');
  assert.equal(got.customized, true);
});

test('a prompt for a section the shell does not have is skipped, not misplaced', () => {
  handleTemplateBlocksPut('design', { rules: [], prompts: [{ section: 'no-such-section', text: 'X' }] });
  assert.equal(templatePrompts('design').some((p) => p.section === 'no-such-section'), false);
});

test('writing blocks leaves the rest of the template untouched', async () => {
  const { readFileSync } = await import('node:fs');
  const { specHtmlPath } = await import('../lib/store-paths.mjs');
  const { ensureTemplates } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  const path = specHtmlPath(templateId('design'));
  const before = readFileSync(path, 'utf8');
  // Compared with whitespace collapsed: rendering a block back in changes the
  // newlines around it, and the claim under test is about content rather than
  // formatting.
  const { stripTemplateBlocks } = await import('../lib/rules/template-blocks.mjs');
  const shellOf = (h) => stripTemplateBlocks(h).replace(/\s+/g, ' ').trim();

  handleTemplateBlocksPut('design', { rules: [custom()], prompts: [{ section: 'design', text: 'X.' }] });
  const after = readFileSync(path, 'utf8');
  assert.notEqual(before, after, 'the blocks did change');
  assert.equal(shellOf(before), shellOf(after),
    'and nothing outside them did: the shell belongs to whoever edits the template');
});

test('a reset restores the shipped blocks', () => {
  handleTemplateBlocksPut('research', { rules: [custom()], prompts: [] });
  assert.equal(handleTemplateBlocksGet('research').rules.some((r) => !r.shipped), true);
  const after = handleTemplateBlocksReset('research');
  assert.equal(after.rules.some((r) => !r.shipped), false, 'the custom rule is gone');
  assert.equal(after.rules.length, TEMPLATE_RULES.research.length, 'and the shipped ones are back');
});

test('resetting rules keeps the type’s section prompts', () => {
  // Raised in review of PR #207: both tabs share one route, so resetting Rules
  // silently cleared the section prompts the confirm never mentioned.
  handleTemplateBlocksPut('design-impl', {
    rules: [custom()],
    prompts: [{ section: 'goals', text: 'One line per goal.' }],
  });
  const after = handleTemplateBlocksReset('design-impl', 'rules');
  assert.equal(after.rules.some((r) => !r.shipped), false, 'the custom rule is gone');
  assert.match(after.prompts.find((p) => p.section === 'goals').text, /One line per goal/,
    'and the other tab is where it was left');
});

test('resetting sections keeps the type’s custom rules', () => {
  handleTemplateBlocksPut('design-impl', {
    rules: [custom()],
    prompts: [{ section: 'goals', text: 'One line per goal.' }],
  });
  const after = handleTemplateBlocksReset('design-impl', 'sections');
  assert.equal(after.prompts.some((p) => p.section === 'goals'), false, 'the added prompt is gone');
  assert.equal(after.rules.some((r) => r.id === 'no_vendor_quotes'), true,
    'and the rule the other tab holds survived');
});

test('resetting sections restores the shipped prompts rather than emptying them', () => {
  handleTemplateBlocksPut('design-impl', { rules: [], prompts: [] });
  const after = handleTemplateBlocksReset('design-impl', 'sections');
  assert.ok(after.prompts.filter((p) => p.shipped).length >= 2);
  assert.equal(after.prompts.every((p) => !p.customized), true);
});

test('an unknown class is refused rather than resetting everything', () => {
  handleTemplateBlocksPut('design', { rules: [custom()], prompts: [] });
  assert.throws(() => handleTemplateBlocksReset('design', 'actions'), /unknown class/);
  assert.equal(handleTemplateBlocksGet('design').rules.some((r) => !r.shipped), true,
    'and nothing was written on the way to the error');
});

test('an unknown type is refused rather than creating one', () => {
  assert.throws(() => handleTemplateBlocksGet('nonsense'), /unknown type/);
  assert.throws(() => handleTemplateBlocksPut('nonsense', {}), /unknown type/);
  assert.throws(() => handleTemplateBlocksReset('nonsense'), /unknown type/);
});

test('a malformed body writes nothing rather than throwing', () => {
  const before = handleTemplateBlocksGet('design').rules.length;
  handleTemplateBlocksPut('design', null);
  assert.equal(handleTemplateBlocksGet('design').rules.length, before);
});

// The Sections and Rules tabs, and the Templates strip.
//
// Driven through the real page script against the real API, for the same reason
// as the other tabs: a stubbed server can agree with a page that sends nonsense.
// What these two tabs are really being asked to prove is that they edit the
// template blocks rather than a copy of them, so several assertions land on
// templateRules / templatePrompts, which is what `create` and `verify` read.
//
// Tasks 4.2 and 3.5.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { loadSettings, tick } from './helpers/settings-dom.mjs';
import {
  handleTemplateBlocksGet, handleTemplateBlocksPut, handleTemplateBlocksReset,
} from '../lib/template-blocks-api.mjs';
import { handlePromptsGet } from '../lib/prompts-api.mjs';
import { templateRules, templatePrompts, templateId, ensureTemplates } from '../lib/store-templates.mjs';
import { SPEC_TYPES } from '../lib/meta.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-stt-');

function open(t, tab) {
  return loadSettings(t, { tab }, {
    respond(call) {
      const m = call.url.match(/^\/api\/template\/([\w-]+)\/blocks$/);
      if (m) {
        if (call.method === 'GET') return handleTemplateBlocksGet(m[1]);
        if (call.method === 'POST') return handleTemplateBlocksReset(m[1]);
        return handleTemplateBlocksPut(m[1], call.body);
      }
      return handlePromptsGet();
    },
  });
}

const settle = async (window) => { await tick(window); await tick(window); await tick(window); };

test('the rules tab lists shipped rules as read-only', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  const rows = [...window.document.querySelectorAll('#sf-shiprules .row')];
  assert.ok(rows.length > 0, 'design-impl ships rules');
  assert.equal(rows.every((r) => /shipped/.test(r.textContent)), true);
  assert.equal(rows.every((r) => !r.querySelector('[data-act="rdel"]')), true,
    'no remove control on the floor under every spec');
});

test('the type picker switches which type is shown', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  const chips = [...window.document.querySelectorAll('.chip.type')];
  assert.equal(chips.length, SPEC_TYPES.length, 'one chip per type');
  const research = chips.find((c) => c.getAttribute('data-type') === 'research');
  research.click();
  await settle(window);
  assert.equal(window.document.querySelector('.chip.type.on').getAttribute('data-type'), 'research');
});

test('adding a custom rule reaches the template, which is what verify reads', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  window.document.getElementById('nr-id').value = 'no_vendor_quotes';
  window.document.getElementById('nr-ask').value = 'No vendor quotes in a spec.';
  window.document.getElementById('nr-fix').value = 'Cut it.';
  window.document.getElementById('nr-create').click();
  await settle(window);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), true);
});

test('a rule id that is not a token is refused in the page', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  window.document.getElementById('nr-id').value = 'No Vendor Quotes';
  window.document.getElementById('nr-ask').value = 'X.';
  window.document.getElementById('nr-create').click();
  await settle(window);
  assert.match(window.document.getElementById('nr-err').textContent, /lowercase/);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'No Vendor Quotes'), false);
});

test('a custom rule can be removed again', async (t) => {
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.', fix: 'Cut it.' }],
    prompts: [],
  });
  const { window } = open(t, 'rules');
  await settle(window);
  const row = window.document.querySelector('#sf-customrules .row[data-id="rule:no_vendor_quotes"]');
  assert.ok(row, 'it is listed as custom');
  row.querySelector('[data-act="rdel"]').click();
  await settle(window);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), false);
});

test('the sections tab lists the type’s prompts', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  const rows = [...window.document.querySelectorAll('#sf-prompts .row')];
  assert.ok(rows.some((r) => /open-questions/.test(r.textContent)), 'the shipped ones are here');
});

test('adding a prompt reaches the template, which is what create reads', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  window.document.getElementById('np-section').value = 'goals';
  window.document.getElementById('np-text').value = 'One line per goal, each verifiable.';
  window.document.getElementById('np-create').click();
  await settle(window);
  const got = templatePrompts('design-impl').find((p) => p.section === 'goals');
  assert.ok(got, 'create will hand this to the agent');
  assert.match(got.text, /One line per goal/);
});

test('editing a prompt replaces its text rather than adding a second', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  const row = window.document.querySelector('#sf-prompts .row[data-id="prompt:decisions"]');
  row.querySelector('[data-act="pedit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="prompt:decisions"]');
  box.querySelector('[data-f="text"]').value = 'Name the option not taken.';
  box.querySelector('[data-act="psave"]').click();
  await settle(window);
  const all = templatePrompts('design-impl').filter((p) => p.section === 'decisions');
  assert.equal(all.length, 1, 'one prompt for the section');
  assert.match(all[0].text, /Name the option not taken/);
});

test('removing a prompt takes it out of the template', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  const row = window.document.querySelector('#sf-prompts .row[data-id="prompt:decisions"]');
  row.querySelector('[data-act="pdel"]').click();
  await settle(window);
  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'decisions'), false);
});

test('the class reset restores the shipped blocks for the type on screen', async (t) => {
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.' }],
    prompts: [],
  });
  const { window } = open(t, 'rules');
  await settle(window);
  window.confirm = () => true;
  window.document.getElementById('sf-reset-class').click();
  await settle(window);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), false);
});

test('the templates strip is on the settings page, one card per type', (t) => {
  ensureTemplates();
  const { window } = open(t, 'language');
  const cards = [...window.document.querySelectorAll('.tcard')];
  assert.equal(cards.length, SPEC_TYPES.length);
  const design = cards.find((c) => c.getAttribute('data-id') === templateId('design'));
  assert.ok(design, 'the design template has a card');
  assert.equal(design.getAttribute('href'), `/spec/${templateId('design')}`,
    'and it opens the template as a spec, which is how it has always been edited');
});

test('the strip renders under every tab, not inside one', (t) => {
  ensureTemplates();
  for (const tab of ['language', 'sections', 'rules', 'actions']) {
    const { window } = open(t, tab);
    const strip = window.document.getElementById('sf-templates');
    assert.ok(strip, `the strip is present on ${tab}`);
    assert.equal(strip.closest('#sf-tabpanel'), null, 'and outside the tab panel');
  }
});

test('a fresh store still shows the strip, seeding on demand', (t) => {
  // No ensureTemplates here: the page seeds them, so a first-run store shows
  // cards rather than an empty box.
  const { window } = open(t, 'language');
  assert.equal(window.document.querySelectorAll('.tcard').length, SPEC_TYPES.length);
});

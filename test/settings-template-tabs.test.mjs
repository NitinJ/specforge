// The Sections and Rules tabs, and the Templates strip.
//
// Driven through the real page script against the real API, for the same reason
// as the other tabs: a stubbed server can agree with a page that sends nonsense.
// What these two tabs are really being asked to prove is that they edit the
// template blocks rather than a copy of them, so several assertions land on
// templateRules / templatePrompts, which is what `create` and `verify` read.
//
// Both tabs are a tree beside a detail pane. The property that matters in that
// shape is that the tree lists what could be edited rather than what has been:
// a list of what exists is a list you cannot add to.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { loadSettings, tick } from './helpers/settings-dom.mjs';
import {
  handleTemplateBlocksGet, handleTemplateBlocksPut, handleTemplateBlocksReset,
} from '../lib/template-blocks-api.mjs';
import { handlePromptsGet } from '../lib/prompts-api.mjs';
import { templateRules, templatePrompts, templateId, ensureTemplates } from '../lib/store-templates.mjs';
import { specTypes } from '../lib/spec-types.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-stt-');

function open(t, tab) {
  return loadSettings(t, { tab }, {
    respond(call) {
      const m = call.url.match(/^\/api\/template\/([\w-]+)\/blocks$/);
      if (m) {
        if (call.method === 'GET') return handleTemplateBlocksGet(m[1]);
        // The class comes off the body, exactly as the daemon reads it: a helper
        // that ignored it would let a page that forgot to send one pass.
        if (call.method === 'POST') return handleTemplateBlocksReset(m[1], call.body && call.body.class);
        return handleTemplateBlocksPut(m[1], call.body);
      }
      return handlePromptsGet();
    },
  });
}

const settle = async (window) => { await tick(window); await tick(window); await tick(window); };
const nodes = (window, sel) => [...window.document.querySelectorAll(sel)];
const pick = async (window, sel) => {
  window.document.querySelector(sel).click();
  await settle(window);
};

// --- Sections ---------------------------------------------------------------

test('the sections tree lists every section, not only the ones with guidance', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  const ids = nodes(window, '#sf-tree .tnode[data-sec]:not(.subrow)')
    .map((n) => n.getAttribute('data-sec'));
  assert.ok(ids.includes('goals'), 'a section with no guidance is offered');
  assert.ok(ids.includes('decisions'), 'and one that ships with guidance is too');
  assert.ok(ids.length >= 10, 'the whole outline is there');
});

test('a section carrying guidance is marked, and one without is not', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  const dot = (id) => Boolean(window.document
    .querySelector(`#sf-tree .tnode[data-sec="${id}"]:not(.subrow) .dot`));
  assert.equal(dot('decisions'), true, 'design-impl ships guidance for decisions');
  assert.equal(dot('goals'), false);
});

test('the headings inside a section are shown and select that section', async (t) => {
  // Guidance attaches per section, so a sub-heading row that selected nothing
  // would be a row you can click and get nowhere.
  const { window } = open(t, 'sections');
  await settle(window);
  const subs = nodes(window, '#sf-tree .tnode.subrow[data-sec="goals"]');
  assert.deepEqual(subs.map((n) => n.textContent.trim()), ['Goals', 'Non-goals'],
    'the Goals section carries two headings of its own');
  subs[1].click();
  await settle(window);
  assert.match(window.document.querySelector('#sf-detail h3').textContent, /Goals/);
});

test('selecting a section shows its guidance in the pane', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="decisions"]:not(.subrow)');
  assert.match(window.document.getElementById('sd-text').value, /\S/,
    'the shipped guidance is what is in force and is what is shown');
});

test('an empty section opens an empty box rather than nothing at all', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="goals"]:not(.subrow)');
  assert.equal(window.document.getElementById('sd-text').value, '');
  assert.ok(window.document.getElementById('sd-del').hasAttribute('disabled'),
    'there is nothing to remove yet');
});

test('writing guidance for a section reaches the template, which is what create reads', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="goals"]:not(.subrow)');
  window.document.getElementById('sd-text').value = 'One line per goal, each verifiable.';
  window.document.getElementById('sd-save').click();
  await settle(window);
  const got = templatePrompts('design-impl').find((p) => p.section === 'goals');
  assert.ok(got, 'create will hand this to the agent');
  assert.match(got.text, /One line per goal/);
});

test('a save leaves the reader on the section they were editing', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="goals"]:not(.subrow)');
  window.document.getElementById('sd-text').value = 'One line per goal.';
  window.document.getElementById('sd-save').click();
  await settle(window);
  assert.match(window.document.querySelector('#sf-detail h3').textContent, /Goals/);
  assert.ok(window.document.querySelector('#sf-tree .tnode[data-sec="goals"]:not(.subrow) .dot'),
    'and the tree now marks it');
});

test('editing a section replaces its guidance rather than adding a second', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="decisions"]:not(.subrow)');
  window.document.getElementById('sd-text').value = 'Name the option not taken.';
  window.document.getElementById('sd-save').click();
  await settle(window);
  const all = templatePrompts('design-impl').filter((p) => p.section === 'decisions');
  assert.equal(all.length, 1, 'one prompt for the section');
  assert.match(all[0].text, /Name the option not taken/);
});

test('an emptied box is refused, because Remove is what takes guidance off', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="decisions"]:not(.subrow)');
  window.document.getElementById('sd-text').value = '   ';
  window.document.getElementById('sd-save').click();
  await settle(window);
  assert.match(window.document.getElementById('sd-msg').textContent, /Remove/);
  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'decisions'), true,
    'and nothing was written');
});

test('Remove takes the guidance out of the template', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="decisions"]:not(.subrow)');
  window.document.getElementById('sd-del').click();
  await settle(window);
  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'decisions'), false);
});

test('a shipped section can be put back without resetting the whole tab', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="decisions"]:not(.subrow)');
  const shipped = window.document.getElementById('sd-text').value;
  window.document.getElementById('sd-text').value = 'Mine.';
  window.document.getElementById('sd-save').click();
  await settle(window);
  window.document.getElementById('sd-reset').click();
  await settle(window);
  assert.equal(window.document.getElementById('sd-text').value, shipped);
});

test('a section with no shipped guidance is not offered a reset', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-sec="goals"]:not(.subrow)');
  assert.equal(window.document.getElementById('sd-reset'), null,
    'there is no shipped text to go back to');
});

test('a section with no id is listed but cannot be selected', async (t) => {
  // The deck shell opens with an unnamed section. A prompt is written into a
  // section by id, so this one has nowhere to put guidance: showing it disabled
  // says that, where hiding it would make the tree disagree with the template.
  // Reached by editing a template as a spec, which is how templates are edited,
  // so the shell is written here rather than relying on a shipped one.
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { specHtmlPath } = await import('../lib/store-paths.mjs');
  ensureTemplates();
  const path = specHtmlPath(templateId('deck'));
  writeFileSync(path, readFileSync(path, 'utf8').replace(/<section id="slide-1"/, '<section'));

  const { window } = open(t, 'sections');
  await settle(window);
  window.document.querySelector('.chip.type[data-type="deck"]').click();
  await settle(window);
  const dead = window.document.querySelector('#sf-tree .tnode.dead');
  assert.ok(dead, 'it is in the tree');
  assert.equal(dead.hasAttribute('data-sec'), false, 'and clicking it selects nothing');
  assert.match(dead.getAttribute('title'), /no id/);
});

test('a nested section is selectable in its own right, and indented', async (t) => {
  // Raised in review of PR #213: the outline swallowed a nested section, so its
  // heading read as the parent's and writing guidance there saved under the
  // parent's id. renderTemplateBlocks writes into any section by id, so a
  // nested one is a real target.
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { specHtmlPath } = await import('../lib/store-paths.mjs');
  ensureTemplates();
  const path = specHtmlPath(templateId('design-impl'));
  writeFileSync(path, readFileSync(path, 'utf8').replace(
    /(<section id="goals"[^>]*>)/,
    '$1<section id="goals-inner"><h3>Inner</h3></section>',
  ));

  const { window } = open(t, 'sections');
  await settle(window);
  const inner = window.document.querySelector('#sf-tree .tnode[data-sec="goals-inner"]');
  assert.ok(inner, 'it is its own row');
  const outer = window.document.querySelector('#sf-tree .tnode[data-sec="goals"]:not(.subrow)');
  assert.ok(parseInt(inner.style.paddingLeft, 10) > parseInt(outer.style.paddingLeft, 10),
    'and it reads as living inside its parent');

  inner.click();
  await settle(window);
  window.document.getElementById('sd-text').value = 'Guidance for the inner one.';
  window.document.getElementById('sd-save').click();
  await settle(window);
  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'goals-inner'), true);
  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'goals'), false,
    'and not under the parent');
});

test('switching type shows that type’s outline and clears the selection', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);
  window.document.querySelector('.chip.type[data-type="research"]').click();
  await settle(window);
  const ids = nodes(window, '#sf-tree .tnode[data-sec]:not(.subrow)')
    .map((n) => n.getAttribute('data-sec'));
  assert.ok(ids.includes('findings'), 'a research section');
  assert.equal(ids.includes('impl-plan'), false, 'and not a design-impl one');
});

// --- Rules ------------------------------------------------------------------

test('the rules tree groups shipped and custom', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  const groups = nodes(window, '#sf-tree .tgroup').map((g) => g.textContent);
  assert.deepEqual(groups, ['Shipped for this type', 'Custom']);
  assert.ok(nodes(window, '#sf-tree .tnode[data-rule]').length > 1);
});

test('a shipped rule reads in full and offers no way to change it', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  const first = window.document.querySelector('#sf-tree .tnode[data-rule]');
  first.click();
  await settle(window);
  assert.match(window.document.querySelector('#sf-detail .path').textContent, /read-only/);
  assert.ok(window.document.querySelector('#sf-detail .ro'), 'the sentence is shown, not hidden');
  assert.equal(window.document.getElementById('rd-save'), null, 'and there is no save');
});

test('adding a rule reaches the template, which is what verify reads', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-rule="+new"]');
  window.document.getElementById('nr-id').value = 'no_vendor_quotes';
  window.document.getElementById('nr-ask').value = 'No vendor quotes in a spec.';
  window.document.getElementById('nr-fix').value = 'Cut it.';
  window.document.getElementById('nr-create').click();
  await settle(window);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), true);
  assert.match(window.document.querySelector('#sf-detail h3').textContent, /no_vendor_quotes/,
    'and the pane shows what was just made');
});

test('a rule id that is not a token is refused in the page', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-rule="+new"]');
  window.document.getElementById('nr-id').value = 'No Vendor Quotes';
  window.document.getElementById('nr-ask').value = 'X.';
  window.document.getElementById('nr-create').click();
  await settle(window);
  assert.match(window.document.getElementById('nr-err').textContent, /lowercase/);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'No Vendor Quotes'), false);
});

test('a custom rule can be edited, which the list-only tab could not do', async (t) => {
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.', fix: 'Cut it.' }],
    prompts: [],
  });
  const { window } = open(t, 'rules');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-rule="no_vendor_quotes"]');
  window.document.getElementById('rd-ask').value = 'No vendor quotes outside a research doc.';
  window.document.getElementById('rd-sev').value = 'advisory';
  window.document.getElementById('rd-save').click();
  await settle(window);
  const got = templateRules('design-impl').find((r) => r.id === 'no_vendor_quotes');
  assert.match(got.ask, /outside a research doc/);
  assert.equal(got.severity, 'advisory');
});

test('a rule with its sentence emptied is refused rather than saved blank', async (t) => {
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.' }], prompts: [],
  });
  const { window } = open(t, 'rules');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-rule="no_vendor_quotes"]');
  window.document.getElementById('rd-ask').value = '  ';
  window.document.getElementById('rd-save').click();
  await settle(window);
  assert.match(window.document.getElementById('rd-msg').textContent, /checks nothing/);
  assert.match(templateRules('design-impl').find((r) => r.id === 'no_vendor_quotes').ask,
    /No vendor quotes/);
});

test('a custom rule can be removed again', async (t) => {
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.', fix: 'Cut it.' }],
    prompts: [],
  });
  const { window } = open(t, 'rules');
  await settle(window);
  await pick(window, '#sf-tree .tnode[data-rule="no_vendor_quotes"]');
  window.document.getElementById('rd-del').click();
  await settle(window);
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), false);
});

test('the type picker switches which type is shown', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  const chips = [...window.document.querySelectorAll('.chip.type')];
  assert.equal(chips.length, specTypes().length, 'one chip per type');
  const research = chips.find((c) => c.getAttribute('data-type') === 'research');
  research.click();
  await settle(window);
  assert.equal(window.document.querySelector('.chip.type.on').getAttribute('data-type'), 'research');
});

test('the reset names the tab it was pressed on, and spares the other', async (t) => {
  // Raised in review of PR #207: the confirm names one tab, so the request has
  // to as well. Without the class both tabs' blocks went.
  handleTemplateBlocksPut('design-impl', {
    rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.' }],
    prompts: [{ section: 'goals', text: 'One line per goal.' }],
  });
  const { window, calls } = open(t, 'rules');
  await settle(window);
  window.confirm = () => true;
  window.document.getElementById('sf-reset-class').click();
  await settle(window);
  assert.equal(calls.filter((c) => c.method === 'POST').pop().body.class, 'rules');
  assert.equal(templateRules('design-impl').some((r) => r.id === 'no_vendor_quotes'), false);
  assert.ok(templatePrompts('design-impl').find((p) => p.section === 'goals'),
    'the Sections tab kept what was written there');
});

// --- Templates tab ----------------------------------------------------------

test('the templates tab shows one card per type, inside the tab panel', (t) => {
  ensureTemplates();
  const { window } = open(t, 'templates');
  // Template cards only. The strip also holds the Add card, which is a button
  // rather than a link to a template and is counted where it belongs, below.
  const cards = [...window.document.querySelectorAll('#sf-tabpanel a.tcard')];
  assert.equal(cards.length, specTypes().length);
  const design = cards.find((c) => c.getAttribute('data-id') === templateId('design'));
  assert.ok(design, 'the design template has a card');
  assert.equal(design.getAttribute('href'), `/spec/${templateId('design')}`,
    'and it opens the template as a spec, which is how it has always been edited');
});

test('templates is a tab of its own, beside the other four', (t) => {
  ensureTemplates();
  const { window } = open(t, 'templates');
  const tabs = [...window.document.querySelectorAll('#sf-tabs .tab')];
  assert.deepEqual(tabs.map((a) => a.getAttribute('data-tab')),
    ['language', 'sections', 'rules', 'actions', 'templates']);
  const on = tabs.find((a) => a.classList.contains('on'));
  assert.equal(on.getAttribute('data-tab'), 'templates');
  // Nothing on this tab is stored in prompts.json or a template block, so the
  // reset control has nothing to reset and is not offered.
  assert.equal(window.document.getElementById('sf-reset-class'), null);
});

test('the other tabs carry no template cards', (t) => {
  ensureTemplates();
  for (const tab of ['language', 'sections', 'rules', 'actions']) {
    const { window } = open(t, tab);
    assert.equal(window.document.querySelectorAll('.tcard').length, 0, `no cards on ${tab}`);
    assert.ok(window.document.getElementById('sf-reset-class'), `reset is still offered on ${tab}`);
  }
});

test('a fresh store still shows the cards, seeding on demand', (t) => {
  // No ensureTemplates here: the page seeds them, so a first-run store shows
  // cards rather than an empty box.
  const { window } = open(t, 'templates');
  assert.equal(window.document.querySelectorAll('a.tcard').length, specTypes().length);
  assert.ok(window.document.getElementById('sf-add-type'), 'plus the Add card');
});

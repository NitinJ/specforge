// End-to-end journeys for the configuration pane.
//
// Each one is the whole loop a person actually runs: customize in the pane,
// see the change reach the thing that consumes it, then reset and see the
// shipped default come back. The tab suites prove a control does what it says;
// these prove the three layers agree, which is where a customization feature
// fails silently. So nothing here asserts on the page after the edit: the
// assertions land on `create`'s payload, on the action registry and on the
// template blocks, which are what an agent actually reads.
//
// Task 4.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { loadSettings, tick } from './helpers/settings-dom.mjs';
import { handlePromptsGet, handlePromptsPut, handlePromptsReset } from '../lib/prompts-api.mjs';
import {
  handleTemplateBlocksGet, handleTemplateBlocksPut, handleTemplateBlocksReset,
} from '../lib/template-blocks-api.mjs';
import { actionById, menuActions, SHIPPED_ACTIONS } from '../lib/actions/all.mjs';
import { templatePrompts } from '../lib/store-templates.mjs';
import { allRules } from '../lib/rules/all.mjs';
import { ALL_GLOBAL_RULES } from '../lib/rules/global.mjs';
import { cmdCreate } from '../lib/specforge-cli.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-cfgj-');

const deps = { ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/' }), session: '' };

/** The page over the real handlers, both classes of route, as the daemon wires them. */
function open(t, tab) {
  return loadSettings(t, { tab }, {
    respond(call) {
      const m = call.url.match(/^\/api\/template\/([\w-]+)\/blocks$/);
      if (m) {
        if (call.method === 'GET') return handleTemplateBlocksGet(m[1]);
        if (call.method === 'POST') return handleTemplateBlocksReset(m[1], call.body && call.body.class);
        return handleTemplateBlocksPut(m[1], call.body);
      }
      if (call.url === '/api/prompts/reset') return handlePromptsReset(call.body.class);
      if (call.method === 'GET') return handlePromptsGet();
      return handlePromptsPut(call.body);
    },
  });
}

const settle = async (window) => { await tick(window); await tick(window); await tick(window); };

/** The class reset is behind a confirm, and jsdom's own throws rather than answering. */
const confirmYes = (window) => { window.confirm = () => true; };

const shipped = (id) => SHIPPED_ACTIONS.find((a) => a.id === id);

test('journey: a house register set in the pane reaches every spec, and comes back off', async (t) => {
  const PREAMBLE = 'Write terse. No metaphors, even in asides.';
  const { window } = open(t, 'language');
  await settle(window);

  window.document.getElementById('sf-lang').value = PREAMBLE;
  window.document.getElementById('sf-lang-save').click();
  await settle(window);

  const during = await cmdCreate({ title: 'A spec written under it', type: 'design' }, deps);
  assert.equal(during.language, PREAMBLE, 'the agent is told before it writes a word');

  confirmYes(window);
  window.document.getElementById('sf-reset-class').click();
  await settle(window);

  const after = await cmdCreate({ title: 'A spec written without it', type: 'design' }, deps);
  assert.equal(after.language, '', 'and the reset reaches the same payload');
  assert.match(window.document.querySelector('#sf-lang-state .chip').textContent, /default/);
});

test('journey: an action reworded in the pane is what the agent resolves', async (t) => {
  const { window } = open(t, 'actions');
  await settle(window);

  window.document.querySelector('#sf-shipped .row[data-id="go_deeper"] [data-act="edit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="go_deeper"]');
  box.querySelector('[data-f="instruction"]').value = 'Answer only the when and the who.';
  box.querySelector('[data-act="save"]').click();
  await settle(window);

  assert.equal(actionById('go_deeper').instruction, 'Answer only the when and the who.',
    'a comment naming this id now resolves to the rewritten text');
  assert.equal(actionById('visualize').instruction, shipped('visualize').instruction,
    'and only the one action moved');

  window.document.querySelector('#sf-shipped .row[data-id="go_deeper"] [data-act="edit"]').click();
  await settle(window);
  window.document.querySelector('.ed[data-id="go_deeper"] [data-act="reset"]').click();
  await settle(window);

  assert.equal(actionById('go_deeper').instruction, shipped('go_deeper').instruction,
    'the reset restores the shipped text rather than a copy of it');
});

test('journey: a custom action reaches the menu, and deleting it keeps its id answering', async (t) => {
  const { window } = open(t, 'actions');
  await settle(window);

  window.document.getElementById('nf-label').value = 'Glossary';
  window.document.getElementById('nf-instruction').value =
    'List every term of art in this block with a one-line definition.';
  window.document.getElementById('nf-create').click();
  await settle(window);

  const entry = menuActions().find((a) => a.id === 'x_glossary');
  assert.ok(entry, 'it is in the menu the browser is handed');
  assert.equal(entry.label, 'Glossary');

  window.document.querySelector('#sf-custom .row[data-id="x_glossary"] [data-act="vis"]').click();
  await settle(window);
  assert.equal(menuActions().some((a) => a.id === 'x_glossary'), false, 'hiding takes it off the menu');
  assert.ok(actionById('x_glossary'), 'and a comment sent while it was visible still resolves');

  window.document.querySelector('#sf-custom .row[data-id="x_glossary"] [data-act="del"]').click();
  await settle(window);
  assert.equal(menuActions().some((a) => a.id === 'x_glossary'), false);
  assert.ok(actionById('x_glossary'), 'deleting leaves the tombstone that keeps the id resolving');
});

test('journey: a section prompt added in the pane is handed over at create', async (t) => {
  const { window } = open(t, 'sections');
  await settle(window);

  window.document.querySelector('#sf-tree .tnode[data-sec="goals"]:not(.subrow)').click();
  await settle(window);
  window.document.getElementById('sd-text').value = 'One line per goal, each one verifiable.';
  window.document.getElementById('sd-save').click();
  await settle(window);

  const out = await cmdCreate({ title: 'A plan', type: 'design-impl' }, deps);
  const goals = out.prompts.find((p) => p.section === 'goals');
  assert.ok(goals, 'create hands the agent the prompt for the section');
  assert.match(goals.text, /each one verifiable/);

  confirmYes(window);
  window.document.getElementById('sf-reset-class').click();
  await settle(window);

  assert.equal(templatePrompts('design-impl').some((p) => p.section === 'goals'), false,
    'the reset takes it out of the template it was written into');
});

test('journey: a rule added for one type is verified against, and cannot displace a shipped one', async (t) => {
  const { window } = open(t, 'rules');
  await settle(window);
  // What verify judges a spec against: the global floor merged with the type's
  // own template rules. Asserting here rather than on the template's list is the
  // point of the journey, since that merge is what an authoring run actually reads.
  const floor = ALL_GLOBAL_RULES.map((r) => r.id);
  const present = (type) => allRules(type).map((r) => r.id);
  assert.ok(floor.every((id) => present('design-impl').includes(id)), 'the floor is in force');

  window.document.querySelector('#sf-tree .tnode[data-rule="+new"]').click();
  await settle(window);
  window.document.getElementById('nr-id').value = 'no_vendor_quotes';
  window.document.getElementById('nr-ask').value = 'No vendor quotes anywhere in the spec.';
  window.document.getElementById('nr-fix').value = 'Cut the quote and state the claim.';
  window.document.getElementById('nr-create').click();
  await settle(window);

  assert.ok(present('design-impl').includes('no_vendor_quotes'), 'verify now judges against it');
  assert.ok(floor.every((id) => present('design-impl').includes(id)),
    'and the floor under every spec is untouched');
  assert.equal(present('research').includes('no_vendor_quotes'), false,
    'a rule for one type is not a rule for another');

  confirmYes(window);
  window.document.getElementById('sf-reset-class').click();
  await settle(window);

  assert.equal(present('design-impl').includes('no_vendor_quotes'), false);
  assert.ok(floor.every((id) => present('design-impl').includes(id)),
    'a reset restores the shipped set rather than emptying the list');
});

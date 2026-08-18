// The configuration page's Language and Actions tabs.
//
// Driven through the real page script, because every control here does its work
// in the browser: a test that asserted on the served markup would be asserting
// on a shell the page had not finished. The fetch stub answers from a fake
// server state, so a control is proven by the request it sends and by what the
// page renders from the answer.
//
// Tasks 3.2 and 3.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { loadSettings, tick } from './helpers/settings-dom.mjs';
import { loadIndex } from './helpers/index-dom.mjs';
import { handlePromptsGet, handlePromptsPut, handlePromptsReset } from '../lib/prompts-api.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-sp-');

/**
 * A settings page wired to the real API over a real (temp) store.
 *
 * The page is the thing under test, so the server side is the actual handlers
 * rather than a hand-written fixture: a test that stubbed the answers could
 * agree with a page that sends nonsense.
 */
function open(t, tab) {
  return loadSettings(t, { tab }, {
    respond(call) {
      if (call.method === 'GET') return handlePromptsGet();
      if (call.url === '/api/prompts/reset') return handlePromptsReset(call.body.class);
      return handlePromptsPut(call.body);
    },
  });
}

const settle = async (window) => { await tick(window); await tick(window); await tick(window); };

test('the language tab shows the stored direction', async (t) => {
  handlePromptsPut({ language: 'Write terse.' });
  const { window } = open(t, 'language');
  await settle(window);
  assert.equal(window.document.getElementById('sf-lang').value, 'Write terse.');
  assert.match(window.document.querySelector('#sf-lang-state .chip').textContent, /customized/);
});

test('an untouched direction reads as default', async (t) => {
  const { window } = open(t, 'language');
  await settle(window);
  assert.equal(window.document.getElementById('sf-lang').value, '',
    'the box is the user’s addition, so nothing they did not write is in it');
  assert.match(window.document.querySelector('#sf-lang-state .chip').textContent, /default/);
});

test('the shipped contract is shown beside the box, read-only', async (t) => {
  // The direction is added on top of the contract rather than replacing it, so
  // the contract is reference rather than the box's value. Without it on screen
  // there is nothing to write "on top of".
  const { window } = open(t, 'language');
  await settle(window);
  const pre = window.document.getElementById('sf-contract');
  assert.match(pre.textContent, /Spec language contract/);
  assert.equal(pre.closest('textarea'), null, 'it is not an editable field');
});

test('copy puts the contract into the box without saving it', async (t) => {
  const { window, calls } = open(t, 'language');
  await settle(window);
  window.document.getElementById('sf-lang-copy').click();
  await settle(window);
  assert.match(window.document.getElementById('sf-lang').value, /Spec language contract/);
  assert.equal(calls.some((c) => c.method === 'PUT'), false, 'nothing was written yet');
  assert.equal(handlePromptsGet().language.value, '');
});

test('copy appends rather than discarding what was already written', async (t) => {
  handlePromptsPut({ language: 'Write terse.' });
  const { window } = open(t, 'language');
  await settle(window);
  window.document.getElementById('sf-lang-copy').click();
  await settle(window);
  const v = window.document.getElementById('sf-lang').value;
  assert.match(v, /^Write terse\./, 'the reader’s own words come first and survive');
  assert.match(v, /Spec language contract/);
});

test('the box counts against the cap the store silently truncates at', async (t) => {
  const { window } = open(t, 'language');
  await settle(window);
  const ta = window.document.getElementById('sf-lang');
  ta.value = 'x'.repeat(120);
  ta.dispatchEvent(new window.Event('input'));
  assert.equal(window.document.getElementById('sf-lang-count').textContent, '120 / 4000');
});

test('a save over the cap is refused, rather than losing the tail', async (t) => {
  // The store truncates at 4,000 without saying so, so the one place a human
  // types this is where the limit has to bite.
  const { window, calls } = open(t, 'language');
  await settle(window);
  const ta = window.document.getElementById('sf-lang');
  ta.value = 'x'.repeat(4001);
  ta.dispatchEvent(new window.Event('input'));
  window.document.getElementById('sf-lang-save').click();
  await settle(window);
  assert.match(window.document.getElementById('sf-lang-msg').textContent, /Too long by 1 character/);
  assert.equal(calls.some((c) => c.method === 'PUT'), false, 'nothing was sent');
  assert.equal(handlePromptsGet().language.value, '');
});

test('saving the direction sends it and re-renders from the answer', async (t) => {
  const { window, calls } = open(t, 'language');
  await settle(window);
  window.document.getElementById('sf-lang').value = 'Short sentences.';
  window.document.getElementById('sf-lang-save').click();
  await settle(window);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.language, 'Short sentences.');
  assert.equal(handlePromptsGet().language.value, 'Short sentences.', 'it reached the store');
  assert.match(window.document.querySelector('#sf-lang-state .chip').textContent, /customized/);
});

test('saving an emptied box sends null, because an empty string cannot clear', async (t) => {
  handlePromptsPut({ language: 'Write terse.' });
  const { window, calls } = open(t, 'language');
  await settle(window);
  window.document.getElementById('sf-lang').value = '   ';
  window.document.getElementById('sf-lang-save').click();
  await settle(window);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.language, null);
  assert.equal(handlePromptsGet().language.value, '');
});

test('reset is offered only once there is something to reset', async (t) => {
  const { window } = open(t, 'language');
  await settle(window);
  assert.ok(window.document.getElementById('sf-lang-reset').hasAttribute('disabled'));
});

test('the actions tab lists shipped actions and their provenance', async (t) => {
  handlePromptsPut({ actions: { overrides: { visualize: { instruction: 'Mine.' } } } });
  const { window } = open(t, 'actions');
  await settle(window);
  const rows = [...window.document.querySelectorAll('#sf-shipped .row')];
  assert.ok(rows.length >= 10, 'every shipped action has a row');
  const viz = rows.find((r) => r.getAttribute('data-id') === 'visualize');
  assert.match(viz.textContent, /customized/);
});

test('a row says its kind and scope, since two are both labelled Delete', async (t) => {
  // Found by rendering: delete_block (local) and delete (aside) are identical on
  // label alone, so the list could not say which row you were about to edit.
  const { window } = open(t, 'actions');
  await settle(window);
  const rows = [...window.document.querySelectorAll('#sf-shipped .row')];
  const deletes = rows.filter((r) => /Delete/.test(r.querySelector('.nm').textContent));
  assert.equal(deletes.length, 2, 'the ambiguity this guards against still exists');
  const chips = deletes.map((r) => [...r.querySelectorAll('.chip')]
    .map((c) => c.textContent).join('|'));
  assert.notEqual(chips[0], chips[1], 'and the rows are told apart by kind and scope');
});

test('the visibility toggle hides an action and says what that does not do', async (t) => {
  const { window } = open(t, 'actions');
  await settle(window);
  const row = window.document.querySelector('#sf-shipped .row[data-id="visualize"]');
  row.querySelector('[data-act="vis"]').click();
  await settle(window);
  assert.deepEqual(handlePromptsGet().actions.shipped
    .filter((a) => a.hidden).map((a) => a.id), ['visualize']);
  const after = window.document.querySelector('#sf-shipped .row[data-id="visualize"]');
  assert.match(after.textContent, /still resolves on old threads/,
    'the page says hiding is not deletion');
});

test('editing a shipped action saves an override, not an identity change', async (t) => {
  const { window, calls } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-shipped .row[data-id="go_deeper"] [data-act="edit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="go_deeper"]');
  box.querySelector('[data-f="instruction"]').value = 'Answer the four questions.';
  box.querySelector('[data-act="save"]').click();
  await settle(window);
  const put = calls.filter((c) => c.method === 'PUT').pop();
  assert.equal(put.body.setOverride.id, 'go_deeper');
  assert.deepEqual(Object.keys(put.body.setOverride).sort(),
    ['id', 'importInstruction', 'instruction'],
    'text only: label, kind and scope are identity and are not sent');
  const stored = handlePromptsGet().actions.shipped.find((a) => a.id === 'go_deeper');
  assert.equal(stored.instruction, 'Answer the four questions.');
  assert.equal(stored.label, 'Go deeper', 'the label is identity and did not move');
});

test('saving one action does not drop another action’s edit', async (t) => {
  // Raised in review of PR #204: the page sent a whole overrides map, so the
  // second save replaced the first rather than joining it.
  handlePromptsPut({ setOverride: { id: 'visualize', instruction: 'Mine for viz.' } });
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-shipped .row[data-id="go_deeper"] [data-act="edit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="go_deeper"]');
  box.querySelector('[data-f="instruction"]').value = 'Mine for depth.';
  box.querySelector('[data-act="save"]').click();
  await settle(window);
  const s = handlePromptsGet();
  assert.equal(s.actions.shipped.find((a) => a.id === 'visualize').instruction, 'Mine for viz.');
  assert.equal(s.actions.shipped.find((a) => a.id === 'go_deeper').instruction, 'Mine for depth.');
});

test('emptying a custom action’s import instruction falls back to the default', async (t) => {
  const { DEFAULT_IMPORT_INSTRUCTION } = await import('../lib/store-prompts.mjs');
  handlePromptsPut({
    actions: {
      custom: [{
        id: 'x_glossary', label: 'Glossary', icon: '📖', kind: 'aside', scope: 'local',
        instruction: 'Define every term.', importInstruction: 'Mine.',
      }],
    },
  });
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-custom .row[data-id="x_glossary"] [data-act="edit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="x_glossary"]');
  box.querySelector('[data-f="importInstruction"]').value = '';
  box.querySelector('[data-act="save"]').click();
  await settle(window);
  const got = handlePromptsGet().actions.custom.find((a) => a.id === 'x_glossary');
  assert.equal(got.importInstruction, DEFAULT_IMPORT_INSTRUCTION,
    'an emptied field resets rather than silently keeping the old text');
});

test('resetting one action leaves the others customized', async (t) => {
  handlePromptsPut({
    actions: { overrides: { visualize: { instruction: 'V' }, go_deeper: { instruction: 'G' } } },
  });
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-shipped .row[data-id="visualize"] [data-act="edit"]').click();
  await settle(window);
  window.document.querySelector('.ed[data-id="visualize"] [data-act="reset"]').click();
  await settle(window);
  const s = handlePromptsGet();
  assert.equal(s.actions.shipped.find((a) => a.id === 'visualize').customized, false);
  assert.equal(s.actions.shipped.find((a) => a.id === 'go_deeper').customized, true);
});

test('creating a custom action prefixes its id', async (t) => {
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.getElementById('nf-label').value = 'Glossary';
  window.document.getElementById('nf-instruction').value = 'Define every term of art.';
  window.document.getElementById('nf-create').click();
  await settle(window);
  const custom = handlePromptsGet().actions.custom;
  assert.equal(custom.length, 1);
  assert.equal(custom[0].id, 'x_glossary');
  assert.equal(custom[0].label, 'Glossary');
});

test('creating without an instruction is refused in the page, not the store', async (t) => {
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.getElementById('nf-label').value = 'Glossary';
  window.document.getElementById('nf-create').click();
  await settle(window);
  assert.match(window.document.getElementById('nf-err').textContent, /instruction/i);
  assert.equal(handlePromptsGet().actions.custom.length, 0, 'nothing was sent');
});

test('a custom action can be deleted from its row', async (t) => {
  handlePromptsPut({
    actions: {
      custom: [{
        id: 'x_glossary', label: 'Glossary', icon: '📖', kind: 'aside', scope: 'local',
        instruction: 'Define every term.',
      }],
    },
  });
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-custom .row[data-id="x_glossary"] [data-act="del"]').click();
  await settle(window);
  assert.equal(handlePromptsGet().actions.custom.length, 0);
});

test('a custom action’s editor offers no reset, having no shipped text', async (t) => {
  handlePromptsPut({
    actions: {
      custom: [{
        id: 'x_glossary', label: 'Glossary', icon: '📖', kind: 'aside', scope: 'local',
        instruction: 'Define every term.',
      }],
    },
  });
  const { window } = open(t, 'actions');
  await settle(window);
  window.document.querySelector('#sf-custom .row[data-id="x_glossary"] [data-act="edit"]').click();
  await settle(window);
  const box = window.document.querySelector('.ed[data-id="x_glossary"]');
  assert.equal(box.querySelector('[data-act="reset"]'), null);
  assert.ok(box.querySelector('[data-act="save"]'), 'but it can still be edited');
});

test('the class reset asks first and clears the whole class', async (t) => {
  handlePromptsPut({ language: 'Terse.' });
  const { window } = open(t, 'language');
  await settle(window);
  let asked = 0;
  window.confirm = () => { asked += 1; return true; };
  window.document.getElementById('sf-reset-class').click();
  await settle(window);
  assert.equal(asked, 1, 'a destructive control confirms');
  assert.equal(handlePromptsGet().language.value, '');
});

test('declining the class reset changes nothing', async (t) => {
  handlePromptsPut({ language: 'Terse.' });
  const { window } = open(t, 'language');
  await settle(window);
  window.confirm = () => false;
  window.document.getElementById('sf-reset-class').click();
  await settle(window);
  assert.equal(handlePromptsGet().language.value, 'Terse.');
});

test('the home page rail carries a configuration row', (t) => {
  const { window } = loadIndex(t, {});
  const cfg = window.document.getElementById('cfg');
  assert.ok(cfg, 'the rail has the row');
  assert.equal(cfg.getAttribute('href'), '/settings');
  assert.equal(cfg.closest('.side') !== null, true, 'and it is in the rail');
});

test('the configuration row comes after every other rail group', (t) => {
  const { window } = loadIndex(t, {});
  const side = window.document.querySelector('.side');
  const kids = [...side.children];
  assert.equal(kids[kids.length - 1].id, 'cfg',
    'pinned last, so it never sits between two groups');
});

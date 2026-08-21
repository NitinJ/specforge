// Removing a kind from the Templates tab.
//
// The only irreversible action on this page, so what these check is mostly the
// asking: a built-in offers nothing, cancel sends nothing, and the refusal a
// user is most likely to hit (specs still use it) lands in the dialog they just
// opened rather than somewhere else.
//
// Spec 45395008a2, task 6.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { loadSettings, tick } from './helpers/settings-dom.mjs';
import { addCustomType } from '../lib/spec-types.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-deltpl-');

const el = (window, id) => window.document.getElementById(id);

/** The Templates tab, with `names` as the user's own kinds. */
function open(t, names = ['Postmortem'], hostOpts = {}) {
  for (const name of names) addCustomType({ name });
  ensureTemplates();
  return loadSettings(t, { tab: 'templates' }, hostOpts);
}

const removeBtn = (window, slug) =>
  window.document.querySelector(`.tdel[data-slug="${slug}"]`);

test('only the kinds you added offer a remove control', () => {
  // A built-in cannot be removed, and a control that only ever refuses is worse
  // than no control.
  const { window } = open({ after: () => {} }, ['Postmortem']);
  assert.ok(removeBtn(window, 'postmortem'), 'yours has one');
  for (const builtin of ['design', 'research', 'impl']) {
    assert.equal(removeBtn(window, builtin), null, `${builtin} does not`);
  }
  window.close();
});

test('your kinds are marked as yours on the card', (t) => {
  const { window } = open(t, ['Postmortem']);
  const mine = window.document.querySelector('.tcardwrap.custom .tsub');
  assert.equal(mine.textContent, 'yours');
});

test('clicking remove asks first, and names what goes', async (t) => {
  const { window, calls } = open(t, ['Postmortem']);
  assert.equal(el(window, 'sf-del').hidden, true, 'closed until asked');

  removeBtn(window, 'postmortem').click();
  await tick();
  assert.equal(el(window, 'sf-del').hidden, false);
  assert.match(el(window, 'sf-del-what').textContent, /postmortem/);
  // Both things, because "are you sure" does not say what is at stake.
  const goes = el(window, 'sf-del-goes').textContent;
  assert.match(goes, /kind/i);
  assert.match(goes, /template/i);
  assert.equal(calls.some((c) => c.method === 'DELETE'), false, 'and nothing is sent yet');
});

test('cancel sends nothing and closes', async (t) => {
  const { window, calls } = open(t, ['Postmortem']);
  removeBtn(window, 'postmortem').click();
  await tick();
  el(window, 'sf-del-cancel').click();
  assert.equal(el(window, 'sf-del').hidden, true);
  assert.equal(calls.some((c) => c.method === 'DELETE'), false);
});

test('confirming sends the delete for that kind', async (t) => {
  const { window, calls } = open(t, ['Postmortem', 'Runbook'], {
    respond: () => ({ slug: 'runbook', removed: { row: true, templateId: 'template-runbook' } }),
  });
  removeBtn(window, 'runbook').click();
  await tick();
  el(window, 'sf-del-go').click();
  await tick();
  const sent = calls.find((c) => c.method === 'DELETE');
  assert.equal(sent.url, '/api/types/runbook', 'the one that was asked about');
});

test('a kind still in use is refused in the dialog, with the count', async (t) => {
  // The refusal a user is most likely to hit, and the answer to the question
  // they just asked. A second surface for it would be a second place to look.
  const { window } = open(t, ['Postmortem'], {
    respond: () => ({
      __status: 409,
      error: '3 specs still use this kind. Change their type, or delete them, before removing it.',
      inUse: 3,
    }),
  });
  removeBtn(window, 'postmortem').click();
  await tick();
  el(window, 'sf-del-go').click();
  await tick();

  assert.equal(el(window, 'sf-del').hidden, false, 'the dialog stays open');
  assert.match(el(window, 'sf-del-err').textContent, /3 specs/);
  assert.equal(el(window, 'sf-del-go').hidden, true,
    'and Remove is withdrawn, having nothing it can do');
  assert.equal(el(window, 'sf-del-stakes').hidden, true,
    'and so is what would be lost: nothing is going to be, and "cannot be undone" '
    + 'above a refusal is the dialog contradicting itself');
});

test('a daemon that cannot be reached says so rather than looking successful', async (t) => {
  const { window } = open(t, ['Postmortem'], {
    respond: () => { throw new Error('network'); },
  });
  removeBtn(window, 'postmortem').click();
  await tick();
  el(window, 'sf-del-go').click();
  await tick();
  assert.match(el(window, 'sf-del-err').textContent, /daemon/i);
});

test('asking again after a refusal offers Remove again', async (t) => {
  // Otherwise the button stays withdrawn from the previous kind's refusal, on a
  // dialog now asking about a different one.
  const { window } = open(t, ['Postmortem', 'Runbook'], {
    respond: () => ({ __status: 409, error: '1 spec still uses this kind.', inUse: 1 }),
  });
  removeBtn(window, 'postmortem').click();
  await tick();
  el(window, 'sf-del-go').click();
  await tick();
  assert.equal(el(window, 'sf-del-go').hidden, true, 'withdrawn on the refusal');

  el(window, 'sf-del-cancel').click();
  removeBtn(window, 'runbook').click();
  await tick();
  assert.equal(el(window, 'sf-del-go').hidden, false, 'offered again for the next one');
  assert.equal(el(window, 'sf-del-err').hidden, true, 'with no leftover message');
  assert.equal(el(window, 'sf-del-stakes').hidden, false, 'and the stakes are back');
  assert.match(el(window, 'sf-del-what').textContent, /runbook/);
});

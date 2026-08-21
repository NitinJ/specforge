// A kind added to the store, exercised the way a spec of it would be.
//
// The unit tests in spec-types.test.mjs prove the registry answers correctly.
// This proves the answer is believed: a row written into the store gives a kind
// that seeds a template, scaffolds a spec, survives validation on the CLI path,
// and shows up where kinds are listed. Those are the eleven readers, checked
// through their own front doors rather than by grepping for the symbol.
//
// Spec 45395008a2, stage 1 verifiable output.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { addCustomType, specTypes } from '../lib/spec-types.mjs';
import { ensureTemplates, templateHtmlFor, templateId } from '../lib/store-templates.mjs';
import { readMeta, defaultMeta } from '../lib/meta.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { handleTemplateBlocksGet } from '../lib/template-blocks-api.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-custom-e2e-');

test('a custom kind gets a seeded template spec, marked and filed like a built-in', () => {
  addCustomType({ name: 'Postmortem', whenToUse: 'after an incident', shell: 'doc' });
  ensureTemplates();

  const id = templateId('postmortem');
  const meta = readMeta(id);
  assert.ok(meta, 'the template spec exists');
  assert.equal(meta.type, 'postmortem');
  assert.equal(meta.template, true, 'protected, like every template');
  assert.equal(meta.collection, 'Templates');
  assert.ok(existsSync(specHtmlPath(id)), 'and it has HTML on disk');
});

test('a custom kind scaffolds from the shell family its row names', () => {
  addCustomType({ name: 'Plain doc', shell: 'doc' });
  addCustomType({ name: 'With a plan', shell: 'impl' });
  ensureTemplates();

  const doc = templateHtmlFor('plain-doc');
  const impl = templateHtmlFor('with-a-plan');
  assert.ok(doc.length > 0 && impl.length > 0, 'both produce HTML (I4)');
  // The plan and tracker SECTIONS, not the data-sf-stage attribute: both shells
  // carry the stage CSS, so the attribute appears in each and says nothing.
  // Whether the document has somewhere to put stages is the actual difference,
  // and it is the whole point of the choice.
  assert.match(impl, /<section id="impl-plan"/, 'the impl shell has a plan');
  assert.match(impl, /<section id="task-tracker"/, 'and a tracker');
  assert.equal(/<section id="impl-plan"/.test(doc), false, 'the doc shell has neither');
  assert.equal(/<section id="task-tracker"/.test(doc), false);
});

test('a kind whose template was never generated still yields a usable shell (I4)', () => {
  // The failure the spec cares about: generation errored, so the template spec
  // holds nothing useful. create must still produce a spec, not an empty file.
  addCustomType({ name: 'Never written' });
  ensureTemplates();
  const html = templateHtmlFor('never-written');
  assert.ok(html.trim().length > 500, 'a real shell, not an empty document');
  assert.match(html, /<html/i);
});

test('defaultMeta accepts a custom kind and still rejects a typo', () => {
  addCustomType({ name: 'Postmortem' });
  assert.equal(defaultMeta({ id: 'x', type: 'postmortem' }).type, 'postmortem');
  assert.equal(defaultMeta({ id: 'x', type: 'postmortemm' }).type, 'general');
});

test('the configuration page is offered the custom kind alongside the built-ins', () => {
  addCustomType({ name: 'Postmortem' });
  ensureTemplates();
  const state = handleTemplateBlocksGet('postmortem');
  assert.ok(state, 'the blocks API answers for it');
  assert.ok(state.types.includes('postmortem'), 'and lists it among the types');
  assert.equal(state.types.length, specTypes().length);
});

test('the blocks API still refuses a kind nobody added', () => {
  assert.throws(() => handleTemplateBlocksGet('postmortem'), /unknown type/);
});

test('the index page type filter offers every kind', async () => {
  addCustomType({ name: 'Postmortem' });
  const { renderIndex } = await import('../server/index-page.mjs');
  // A spec has to exist or the toolbar is not rendered at all.
  const { createSpec } = await import('../lib/store.mjs');
  createSpec({ title: 'Something', html: '<h1>Something</h1>' });
  const html = renderIndex();
  for (const kind of specTypes()) {
    assert.ok(html.includes(`<option>${kind}</option>`), `${kind} is filterable`);
  }
});

test('a spec created with a custom kind records it', async () => {
  addCustomType({ name: 'Postmortem' });
  ensureTemplates();
  const { createSpec } = await import('../lib/store.mjs');
  const id = createSpec({ title: 'Checkout outage', html: templateHtmlFor('postmortem'), type: 'postmortem' });
  assert.equal(readMeta(id).type, 'postmortem');
  assert.ok(readFileSync(specHtmlPath(id), 'utf8').length > 500);
});

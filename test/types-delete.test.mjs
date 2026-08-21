// Removing a kind you added.
//
// Q1, answered yes after Add shipped. What makes this safe rather than merely
// possible is the refusal: a kind still carried by specs cannot go, because
// their `type` would name nothing and defaultMeta would quietly read them as
// `general` on the next write. So every test here checks what is on disk after
// the answer, not only the answer.
//
// Spec 45395008a2, tasks 6.1 and 6.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession } from './helpers/live-session.mjs';
import { handleTypeCreate, handleTypeDelete } from '../lib/types-api.mjs';
import {
  addCustomType, removeCustomType, customTypes, specTypes, isSpecType,
} from '../lib/spec-types.mjs';
import { specsOfType, readMeta } from '../lib/meta.mjs';
import { createSpec } from '../lib/store.mjs';
import { ensureTemplates, templateId, templateHtmlFor } from '../lib/store-templates.mjs';
import { specDir, typesPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-typesdel-');

/** A custom kind, created the way the route does. */
function seedKind(name = 'Postmortem') {
  seedLiveSession();
  const out = handleTypeCreate({ name, prompt: 'what happened, impact' });
  assert.equal(out.status, 201, 'the fixture created the kind');
  return out.body;
}

// --- the registry (6.1) -----------------------------------------------------

test('removing a custom kind takes its row out', () => {
  addCustomType({ name: 'Postmortem' });
  addCustomType({ name: 'Keeper' });
  assert.equal(removeCustomType('postmortem'), true);
  assert.deepEqual(customTypes().map((t) => t.slug), ['keeper']);
  assert.equal(isSpecType('postmortem'), false);
});

test('removing one that was never there answers false rather than throwing', () => {
  assert.equal(removeCustomType('never-existed'), false);
});

test('a built-in kind cannot be removed (I7)', () => {
  // Not merely refused: the row is in code, so a removal would report a success
  // it did not achieve and the kind would still be there on the next read.
  for (const builtin of ['general', 'design', 'research', 'deck', 'design-impl', 'impl']) {
    assert.throws(() => removeCustomType(builtin), /built-in/i, `${builtin} is protected`);
  }
  assert.equal(specTypes().length, 6, 'and all six are still here');
});

test('specsOfType counts specs of a kind, and ignores the kind\'s own template', () => {
  // The template spec carries the type too. Counting it would make every kind
  // permanently in use by itself.
  addCustomType({ name: 'Postmortem' });
  ensureTemplates();
  assert.deepEqual(specsOfType('postmortem'), []);

  const id = createSpec({ title: 'An outage', html: '<h1>x</h1>', type: 'postmortem' });
  assert.deepEqual(specsOfType('postmortem'), [id]);
});

test('specsOfType does not confuse one kind with another', () => {
  addCustomType({ name: 'Postmortem' });
  createSpec({ title: 'A design', html: '<h1>x</h1>', type: 'design' });
  assert.deepEqual(specsOfType('postmortem'), []);
});

// --- the route (6.2) --------------------------------------------------------

test('deleting a kind removes the row and the template spec together', () => {
  const { slug, templateId: tid } = seedKind();
  assert.ok(existsSync(specDir(tid)), 'the template spec exists first');

  const out = handleTypeDelete(slug);
  assert.equal(out.status, 200);
  assert.equal(out.body.slug, slug);
  assert.equal(isSpecType(slug), false, 'the kind is gone');
  assert.equal(existsSync(specDir(tid)), false, 'and so is its template spec');
  assert.equal(readMeta(tid), null);
});

test('a kind still carried by specs is refused, with the count (I6)', () => {
  const { slug, templateId: tid } = seedKind();
  createSpec({ title: 'One outage', html: '<h1>x</h1>', type: slug });
  createSpec({ title: 'Another outage', html: '<h1>x</h1>', type: slug });

  const out = handleTypeDelete(slug);
  assert.equal(out.status, 409);
  assert.equal(out.body.inUse, 2, 'the page can say how many');
  assert.match(out.body.error, /2/);
  assert.equal(isSpecType(slug), true, 'the kind stays');
  assert.ok(existsSync(specDir(tid)), 'and so does its template');
});

test('the kind\'s own template does not count as a spec using it', () => {
  // Otherwise no kind could ever be deleted: seeding creates the template, and
  // the template carries the type.
  const { slug } = seedKind();
  assert.equal(handleTypeDelete(slug).status, 200);
});

test('a built-in kind answers 403 and is untouched', () => {
  ensureTemplates();
  const out = handleTypeDelete('design');
  assert.equal(out.status, 403);
  assert.match(out.body.error, /built-in/i);
  assert.ok(isSpecType('design'));
  assert.ok(existsSync(specDir(templateId('design'))), 'its template is still there');
});

test('an unknown kind answers 404', () => {
  assert.equal(handleTypeDelete('never-existed').status, 404);
});

test('a refusal leaves types.json byte-identical', () => {
  const { slug } = seedKind();
  createSpec({ title: 'An outage', html: '<h1>x</h1>', type: slug });
  const before = readFileSync(typesPath(), 'utf8');
  assert.equal(handleTypeDelete(slug).status, 409);
  assert.equal(readFileSync(typesPath(), 'utf8'), before);
});

test('a kind can be created again after being deleted', () => {
  // The point of the whole stage: the Templates tab is somewhere to experiment,
  // which means an experiment can be undone and redone.
  const { slug } = seedKind();
  handleTypeDelete(slug);
  const again = handleTypeCreate({ name: 'Postmortem', prompt: 'second time' });
  assert.equal(again.status, 201);
  assert.equal(again.body.slug, 'postmortem');
  assert.match(readMeta(again.body.templateId).generate.prompt, /second time/);
});

test('deleting one kind leaves the others alone', () => {
  const a = seedKind('Postmortem');
  const b = seedKind('Runbook');
  handleTypeDelete(a.slug);
  assert.equal(isSpecType(b.slug), true);
  assert.ok(existsSync(specDir(b.templateId)));
  assert.ok(templateHtmlFor(b.slug).length > 500, 'and it still scaffolds');
});

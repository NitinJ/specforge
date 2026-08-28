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
  addCustomType, removeCustomType, customTypes, specTypes, isSpecType, BUILTIN,
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
  assert.equal(specTypes().length, Object.keys(BUILTIN).length, 'and every one is still here');
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

test('deleting a kind removes the row and the template spec together', async () => {
  const { slug, templateId: tid } = seedKind();
  assert.ok(existsSync(specDir(tid)), 'the template spec exists first');

  const out = await handleTypeDelete(slug);
  assert.equal(out.status, 200);
  assert.equal(out.body.slug, slug);
  assert.equal(isSpecType(slug), false, 'the kind is gone');
  assert.equal(existsSync(specDir(tid)), false, 'and so is its template spec');
  assert.equal(readMeta(tid), null);
});

test('a kind still carried by specs is refused, with the count (I6)', async () => {
  const { slug, templateId: tid } = seedKind();
  createSpec({ title: 'One outage', html: '<h1>x</h1>', type: slug });
  createSpec({ title: 'Another outage', html: '<h1>x</h1>', type: slug });

  const out = await handleTypeDelete(slug);
  assert.equal(out.status, 409);
  assert.equal(out.body.inUse, 2, 'the page can say how many');
  assert.match(out.body.error, /2/);
  assert.equal(isSpecType(slug), true, 'the kind stays');
  assert.ok(existsSync(specDir(tid)), 'and so does its template');
});

test('the kind\'s own template does not count as a spec using it', async () => {
  // Otherwise no kind could ever be deleted: seeding creates the template, and
  // the template carries the type.
  const { slug } = seedKind();
  assert.equal((await handleTypeDelete(slug)).status, 200);
});

test('a built-in kind answers 403 and is untouched', async () => {
  ensureTemplates();
  const out = await handleTypeDelete('design');
  assert.equal(out.status, 403);
  assert.match(out.body.error, /built-in/i);
  assert.ok(isSpecType('design'));
  assert.ok(existsSync(specDir(templateId('design'))), 'its template is still there');
});

test('an unknown kind answers 404', async () => {
  assert.equal((await handleTypeDelete('never-existed')).status, 404);
});

test('a refusal leaves types.json byte-identical', async () => {
  const { slug } = seedKind();
  createSpec({ title: 'An outage', html: '<h1>x</h1>', type: slug });
  const before = readFileSync(typesPath(), 'utf8');
  assert.equal((await handleTypeDelete(slug)).status, 409);
  assert.equal(readFileSync(typesPath(), 'utf8'), before);
});

test('a kind can be created again after being deleted', async () => {
  // The point of the whole stage: the Templates tab is somewhere to experiment,
  // which means an experiment can be undone and redone.
  const { slug } = seedKind();
  await handleTypeDelete(slug);
  const again = handleTypeCreate({ name: 'Postmortem', prompt: 'second time' });
  assert.equal(again.status, 201);
  assert.equal(again.body.slug, 'postmortem');
  assert.match(readMeta(again.body.templateId).generate.prompt, /second time/);
});

// --- the revoke barrier -----------------------------------------------------
//
// The route hands the handler pubs.unshareThen rather than wrapping the call in
// it, so the barrier closes only once there is nothing left to refuse. Wrapping
// it meant a 403 or a 409 had already taken the template's public link down on
// the way to saying no. Raised in review of PR #228.

/** A stand-in for pubs.unshareThen that records whether it was entered. */
function spyRevoke() {
  const seen = [];
  return {
    seen,
    revoke: async (id, fn) => { seen.push(id); return fn(); },
  };
}

test('a successful delete goes through the revoke barrier', async () => {
  const { slug, templateId: tid } = seedKind();
  const spy = spyRevoke();
  const out = await handleTypeDelete(slug, { revoke: spy.revoke });
  assert.equal(out.status, 200);
  assert.deepEqual(spy.seen, [tid], 'entered, for the template spec');
});

test('a refused delete never enters it', async () => {
  // Each refusal separately: they are three different early returns, and the one
  // that regressed was in the middle.
  const inUse = seedKind('Postmortem');
  createSpec({ title: 'An outage', html: '<h1>x</h1>', type: inUse.slug });

  for (const [what, slug] of [['in use', inUse.slug], ['built-in', 'design'], ['unknown', 'nope']]) {
    const spy = spyRevoke();
    const out = await handleTypeDelete(slug, { revoke: spy.revoke });
    assert.notEqual(out.status, 200, `${what} is refused`);
    assert.deepEqual(spy.seen, [], `${what} did not unpublish anything on the way`);
  }
});

test('an attached template that survives a refusal stays attached', async () => {
  // Nothing is detached ahead of the removal any more. Detaching before a step
  // that can fail left a surviving template unattached, which is a mutation the
  // refusal existed to prevent.
  const { slug, templateId: tid } = seedKind();
  createSpec({ title: 'An outage', html: '<h1>x</h1>', type: slug });
  const before = readMeta(tid).attachedSession;
  assert.ok(before, 'the fixture attached it');

  assert.equal((await handleTypeDelete(slug)).status, 409);
  assert.equal(readMeta(tid).attachedSession, before, 'still owned by the same session');
});

test('a template spec that cannot be removed leaves the kind whole', async () => {
  // Raised in review of PR #228. The fallible step runs first, so a failure
  // there leaves everything exactly as it was rather than reporting a 200 for a
  // kind with no row and a template spec still on the index.
  const { slug, templateId: tid } = seedKind();
  const { chmodSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  // Unwritable parent, which is what rmSync needs to unlink a child. Restored
  // in the same breath rather than in a hook: the store's own afterEach removes
  // the directory, and it cannot do that through a mode this test left behind.
  const parent = dirname(specDir(tid));
  chmodSync(parent, 0o500);
  let out;
  try {
    out = await handleTypeDelete(slug);
  } finally {
    chmodSync(parent, 0o700);
  }

  assert.equal(out.status, 500);
  assert.match(out.body.error, /template spec/);
  assert.equal(isSpecType(slug), true, 'the kind is still whole');
  assert.ok(existsSync(specDir(tid)), 'and its template is still there');
});

test('deleting one kind leaves the others alone', async () => {
  const a = seedKind('Postmortem');
  const b = seedKind('Runbook');
  await handleTypeDelete(a.slug);
  assert.equal(isSpecType(b.slug), true);
  assert.ok(existsSync(specDir(b.templateId)));
  assert.ok(templateHtmlFor(b.slug).length > 500, 'and it still scaffolds');
});

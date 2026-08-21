// The kind registry: what kinds of spec exist, and where the answer comes from.
//
// Kinds were the keys of a frozen object in lib/meta.mjs, read in eleven places.
// They are now the built-in table plus whatever ~/.specforge/types.json holds, so
// a kind can be added without a code change. Everything downstream treats the two
// identically; the only difference is where the definition is read from.
//
// Spec 45395008a2, tasks 1.1 and 1.2.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import {
  BUILTIN_SHELL, specTypes, specType, isSpecType, addCustomType, customTypes, slugify,
} from '../lib/spec-types.mjs';
import { storeRoot, typesPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-types-');

/** Write types.json directly, to seed a store without going through the API. */
function seedTypes(custom) {
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({ custom }, null, 2));
}

// --- the built-ins are untouched (I2) --------------------------------------

test('an empty store lists exactly the six built-in kinds, in their own order', () => {
  assert.deepEqual(specTypes(), ['general', 'design', 'research', 'deck', 'design-impl', 'impl']);
});

test('the built-in table still says which shell each scaffolds from', () => {
  assert.equal(BUILTIN_SHELL.design, 'doc');
  assert.equal(BUILTIN_SHELL['design-impl'], 'impl');
  assert.deepEqual(Object.keys(BUILTIN_SHELL), specTypes());
});

test('a built-in reads back as built-in, with a label and no when-to-use text', () => {
  const t = specType('research');
  assert.equal(t.slug, 'research');
  assert.equal(t.shell, 'doc');
  assert.equal(t.builtin, true);
  assert.equal(typeof t.label, 'string');
});

test('an unknown kind is null, not a throw', () => {
  // Callers already branch on unknown kinds; making this throw would turn every
  // typo into a crash rather than a validation message.
  assert.equal(specType('postmortem'), null);
  assert.equal(isSpecType('postmortem'), false);
});

// --- custom kinds -----------------------------------------------------------

test('a custom kind joins the list, after the built-ins', () => {
  seedTypes([{ slug: 'postmortem', label: 'Postmortem', shell: 'doc', whenToUse: 'after an incident', created: 1 }]);
  assert.deepEqual(specTypes(), [
    'general', 'design', 'research', 'deck', 'design-impl', 'impl', 'postmortem',
  ]);
  assert.equal(isSpecType('postmortem'), true);
});

test('custom kinds keep creation order, so the list does not reshuffle', () => {
  seedTypes([
    { slug: 'zeta', label: 'Zeta', shell: 'doc', whenToUse: '', created: 1 },
    { slug: 'alpha', label: 'Alpha', shell: 'doc', whenToUse: '', created: 2 },
  ]);
  assert.deepEqual(specTypes().slice(6), ['zeta', 'alpha']);
});

test('a custom kind carries its when-to-use text, which is what makes it choosable', () => {
  seedTypes([{ slug: 'postmortem', label: 'Postmortem', shell: 'impl', whenToUse: 'an incident is over', created: 1 }]);
  const t = specType('postmortem');
  assert.equal(t.builtin, false);
  assert.equal(t.shell, 'impl');
  assert.equal(t.whenToUse, 'an incident is over');
  assert.equal(t.label, 'Postmortem');
});

test('customTypes lists only the custom ones', () => {
  seedTypes([{ slug: 'postmortem', label: 'Postmortem', shell: 'doc', whenToUse: '', created: 1 }]);
  assert.deepEqual(customTypes().map((t) => t.slug), ['postmortem']);
});

// --- the store file degrades rather than throwing ---------------------------

test('no types.json reads as no custom kinds', () => {
  assert.deepEqual(specTypes().length, 6);
  assert.deepEqual(customTypes(), []);
});

test('an unparseable types.json reads as no custom kinds', () => {
  // Same rule readGlobalPrefs and loadStore already use: a broken store file
  // must not take the daemon down.
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), '{ not json');
  assert.deepEqual(specTypes().length, 6);
});

test('a row missing required fields is dropped, not half-loaded', () => {
  seedTypes([
    { label: 'No slug', shell: 'doc' },
    { slug: 'ok', label: 'Fine', shell: 'doc', whenToUse: '', created: 1 },
    { slug: 'BAD SLUG', label: 'Malformed', shell: 'doc', whenToUse: '', created: 2 },
  ]);
  assert.deepEqual(customTypes().map((t) => t.slug), ['ok']);
});

test('a row naming an unknown shell falls back to doc rather than being dropped', () => {
  // The shell decides which scaffold a spec gets. A wrong value should cost the
  // plainer shell, not the whole kind.
  seedTypes([{ slug: 'odd', label: 'Odd', shell: 'nonsense', whenToUse: '', created: 1 }]);
  assert.equal(specType('odd').shell, 'doc');
});

test('a custom row may not shadow a built-in', () => {
  // Two definitions for one slug would give one template spec two owners.
  seedTypes([{ slug: 'design', label: 'Not the real one', shell: 'impl', whenToUse: '', created: 1 }]);
  assert.equal(specTypes().filter((t) => t === 'design').length, 1);
  assert.equal(specType('design').builtin, true, 'the built-in wins');
});

// --- slugs (E3) -------------------------------------------------------------

test('a name becomes a slug', () => {
  assert.equal(slugify('Postmortem'), 'postmortem');
  assert.equal(slugify('  Incident   Review  '), 'incident-review');
  assert.equal(slugify('RFC / ADR'), 'rfc-adr');
  assert.equal(slugify('Design—Impl'), 'design-impl');
});

test('a name that cannot become a slug returns empty', () => {
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(''), '');
  assert.equal(slugify('a'), '', 'one character is under the two-character floor');
});

test('a slug is capped at 32 characters', () => {
  assert.equal(slugify('x'.repeat(80)).length, 32);
});

// --- adding one (I1) --------------------------------------------------------

test('adding a kind writes a row and returns it', () => {
  const added = addCustomType({ name: 'Postmortem', whenToUse: 'after an incident', shell: 'doc' });
  assert.equal(added.slug, 'postmortem');
  assert.equal(added.label, 'Postmortem');
  assert.equal(added.templateId, 'template-postmortem');
  assert.equal(isSpecType('postmortem'), true);
  const raw = JSON.parse(readFileSync(typesPath(), 'utf8'));
  assert.equal(raw.custom.length, 1);
  assert.equal(raw.custom[0].slug, 'postmortem');
});

test('adding two keeps both', () => {
  addCustomType({ name: 'One' });
  addCustomType({ name: 'Two' });
  assert.deepEqual(customTypes().map((t) => t.slug), ['one', 'two']);
});

test('a slug that collides with a built-in is refused', () => {
  assert.throws(() => addCustomType({ name: 'Design' }), /already/i);
  assert.deepEqual(customTypes(), [], 'and nothing is written');
});

test('a slug that collides with another custom kind is refused', () => {
  addCustomType({ name: 'Postmortem' });
  assert.throws(() => addCustomType({ name: 'POSTMORTEM' }), /already/i);
  assert.equal(customTypes().length, 1);
});

test('names that differ by more than case are different kinds', () => {
  // "post mortem" slugs to post-mortem, which is not postmortem. Slugs are exact
  // identifiers and a template spec is named after one, so near-misses stay
  // distinct rather than being folded together.
  addCustomType({ name: 'Postmortem' });
  addCustomType({ name: 'Post mortem' });
  assert.deepEqual(customTypes().map((t) => t.slug), ['postmortem', 'post-mortem']);
});

test('a slug that is a reserved store id is refused', () => {
  // A reserved id names a document served at its own route. A kind taking one
  // would put a template spec where the component library lives.
  assert.throws(() => addCustomType({ name: 'specforge components' }), /reserved/i);
});

test('a name that yields no usable slug is refused', () => {
  assert.throws(() => addCustomType({ name: '!!!' }), /name/i);
  assert.throws(() => addCustomType({ name: '' }), /name/i);
});

test('the shell defaults to doc and only accepts the two families', () => {
  assert.equal(addCustomType({ name: 'Plain' }).shell, 'doc');
  assert.equal(addCustomType({ name: 'Planned', shell: 'impl' }).shell, 'impl');
  assert.throws(() => addCustomType({ name: 'Odd', shell: 'nonsense' }), /shell/i);
});

test('label and when-to-use are trimmed and capped', () => {
  const t = addCustomType({ name: `  ${'N'.repeat(200)}  `, whenToUse: 'w'.repeat(900) });
  assert.equal(t.label.length, 60);
  assert.equal(t.whenToUse.length, 400);
});

test('a refused add leaves the file exactly as it was (I3)', () => {
  addCustomType({ name: 'Keeper' });
  const before = readFileSync(typesPath(), 'utf8');
  assert.throws(() => addCustomType({ name: 'Keeper' }));
  assert.equal(readFileSync(typesPath(), 'utf8'), before);
});

// The document kinds that ship with the plugin.
//
// Twelve kinds whose shells and section prompts are built from one table rather
// than from committed HTML. What is asserted here is the property that makes
// that safe: what the seeder produces matches what the definition says, so a
// section renamed in one place cannot leave the other pointing at nothing.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mkdirSync, writeFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { storeRoot, typesPath, specHtmlPath } from '../lib/store-paths.mjs';
import { DOCUMENT_TYPES } from '../lib/document-types.mjs';
import { specTypes, specType, BUILTIN, shadowedTypes, templateIdFor } from '../lib/spec-types.mjs';
import { ensureTemplates, templateHtmlFor, templatePrompts } from '../lib/store-templates.mjs';
import { stripTemplateBlocks, hasTemplateBlocks } from '../lib/rules/template-blocks.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-doctypes-');

/** The kinds that carry their own sections, which is all of them but `general`. */
const AUTHORED = DOCUMENT_TYPES.filter((d) => !d.promptOnly);

const sectionIds = (html) => [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const tocIds = (html) => {
  const nav = /<nav class="toc">([\s\S]*?)<\/nav>/.exec(html);
  return nav ? [...nav[1].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]) : [];
};

// --- they are kinds ---------------------------------------------------------

test('every document kind is a built-in kind', () => {
  for (const def of DOCUMENT_TYPES) {
    assert.ok(BUILTIN[def.slug], `${def.slug} is defined but not registered`);
  }
});

test('an empty store already lists them, with no types.json', () => {
  // The point of shipping them: a fresh store has them without anyone adding
  // anything. A kind that only exists once the user creates it is not shipped.
  const listed = specTypes();
  for (const def of DOCUMENT_TYPES) {
    assert.ok(listed.includes(def.slug), `${def.slug} missing from a fresh store`);
  }
});

test('each one says when to use it, and what it is not for', () => {
  for (const def of AUTHORED) {
    const { whenToUse } = specType(def.slug);
    assert.ok(whenToUse.length > 40, `${def.slug}: ${whenToUse}`);
    assert.match(whenToUse, /\b(not|rather than|instead|over|before|after|pick)\b/i, def.slug);
  }
});

test('every kind names its own artifact in its line', () => {
  // "Write a PRD" has to match the prd kind, and it only does if the line
  // contains the word a person would use. Twelve of the eighteen did not: the
  // prd line never said "PRD", the launch-plan line never said "launch", so
  // naming the kind outright was the least reliable way to select it.
  //
  // `spec` is excluded because it is in half the slugs and in the word "spec"
  // on every page, so requiring it would assert nothing.
  for (const slug of specTypes()) {
    const { whenToUse } = specType(slug);
    for (const word of slug.split('-').filter((w) => w !== 'spec')) {
      assert.match(whenToUse, new RegExp(`\\b${word}`, 'i'),
        `${slug}'s line never says "${word}", so a request naming it will not match`);
    }
  }
});

// --- upgrading a store that already used one of these slugs -----------------

test('a stored row for a now-shipped kind is reported, not silently dropped', () => {
  // The upgrade case: a store written before these kinds shipped can hold a
  // custom row for one of their slugs. The built-in has to win, or an upgrade
  // could never add a kind. But the row carried a description its author wrote,
  // and replacing it without saying so leaves someone comparing this list
  // against types.json with entries that do not appear and no reason why.
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({
    custom: [
      { slug: 'test-plan', label: 'Test plan', shell: 'doc', whenToUse: 'mine, not yours', created: 1 },
      { slug: 'postmortem', label: 'Postmortem', shell: 'doc', whenToUse: 'after an incident', created: 2 },
    ],
  }));

  assert.deepEqual(shadowedTypes().map((t) => t.slug), ['test-plan']);
  assert.equal(shadowedTypes()[0].whenToUse, 'mine, not yours', 'what they wrote is still readable');
  assert.equal(specType('test-plan').builtin, true, 'the shipped definition wins');
  assert.equal(specType('postmortem').builtin, false, 'a row that shadows nothing is untouched');
});

test('a store with no collisions reports none', () => {
  assert.deepEqual(shadowedTypes(), []);
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({
    custom: [{ slug: 'postmortem', label: 'P', shell: 'doc', whenToUse: 'x', created: 1 }],
  }));
  assert.deepEqual(shadowedTypes(), []);
});

test('a shadowed kind keeps the template spec its author edited', async () => {
  // Nothing is lost that cannot be read: the store copy still wins over the
  // bundled shell, so their sections survive under the shipped kind's name.
  ensureTemplates();
  const id = templateIdFor('test-plan');
  writeFileSync(specHtmlPath(id), '<html><body><section id="theirs">kept</section></body></html>');
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({
    custom: [{ slug: 'test-plan', label: 'T', shell: 'doc', whenToUse: 'mine', created: 1 }],
  }));
  assert.match(templateHtmlFor('test-plan'), /id="theirs"/);
});

// --- the shells are built from the definitions ------------------------------

test('a seeded template holds exactly the sections its definition names', async () => {
  ensureTemplates();
  for (const def of AUTHORED) {
    const html = templateHtmlFor(def.slug);
    assert.deepEqual(
      sectionIds(html),
      def.sections.map((s) => s.id),
      `${def.slug}'s sections do not match its definition`,
    );
  }
});

test('every section is reachable from the table of contents', async () => {
  ensureTemplates();
  for (const def of AUTHORED) {
    const html = templateHtmlFor(def.slug);
    assert.deepEqual(tocIds(html), def.sections.map((s) => s.id), def.slug);
  }
});

test('every prompt is keyed to a section that exists', async () => {
  // The failure this catches: a prompt keyed to a renamed section is never
  // rendered and never reaches the agent, and nothing else notices.
  ensureTemplates();
  for (const def of DOCUMENT_TYPES) {
    const html = templateHtmlFor(def.slug);
    const ids = sectionIds(html);
    for (const p of templatePrompts(def.slug)) {
      assert.ok(ids.includes(p.section), `${def.slug}: prompt on missing section "${p.section}"`);
    }
  }
});

test('every section carries guidance', async () => {
  // A section with no prompt is a section the agent fills in from the heading
  // alone, which is the state these kinds exist to improve on.
  ensureTemplates();
  for (const def of AUTHORED) {
    const got = new Set(templatePrompts(def.slug).map((p) => p.section));
    for (const s of def.sections) {
      assert.ok(got.has(s.id), `${def.slug}: section "${s.id}" has no prompt`);
    }
  }
});

test('the scaffolding does not reach a scaffolded spec', async () => {
  ensureTemplates();
  for (const def of DOCUMENT_TYPES) {
    const spec = stripTemplateBlocks(templateHtmlFor(def.slug));
    assert.equal(hasTemplateBlocks(spec), false, `${def.slug} leaks its own scaffolding`);
    assert.ok(!spec.includes('data-sf-prompt'), def.slug);
  }
});

test('general keeps the shell it ships with, and gains only a prompt', async () => {
  // promptOnly: the built-in already has a shell worth keeping, and rewriting it
  // from a definition would replace something the plugin maintains.
  ensureTemplates();
  const html = templateHtmlFor('general');
  assert.equal(sectionIds(html).length, 1);
  assert.deepEqual(sectionIds(html), ['tldr']);
  assert.equal(templatePrompts('general').length, 1);
});

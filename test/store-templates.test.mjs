import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { SPEC_TYPES, readMeta } from '../lib/meta.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';
import { readSpecHtml, writeSpecHtml } from '../lib/store.mjs';
import {
  templateId, ensureTemplates, templateHtmlFor, TEMPLATE_COLLECTION,
} from '../lib/store-templates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-tpl-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('ensureTemplates seeds one protected template spec per spec type', () => {
  ensureTemplates();
  for (const type of SPEC_TYPES) {
    const meta = readMeta(templateId(type));
    assert.ok(meta, `template spec for ${type} exists`);
    assert.equal(meta.template, true, 'flagged as a template (protected)');
    assert.equal(meta.type, type, 'typed like the specs it scaffolds');
    assert.equal(meta.collection, TEMPLATE_COLLECTION, 'grouped under the Templates collection');
    assert.match(meta.title, /Template/, 'clearly titled as a template');
    const html = readSpecHtml(templateId(type));
    assert.match(html, /\{\{TITLE\}\}/, 'seeded from the bundled shell (placeholders intact)');
  }
});

test('ensureTemplates is idempotent — a re-run never clobbers an edited template', () => {
  ensureTemplates();
  const id = templateId('design');
  const edited = readSpecHtml(id).replace('{{TITLE}}', '{{TITLE}} EDITED-MARKER');
  writeSpecHtml(id, edited);
  ensureTemplates();
  assert.match(readSpecHtml(id), /EDITED-MARKER/, 'the edit survives a reseed');
});

test('templateHtmlFor prefers the store template over the bundled shell', () => {
  ensureTemplates();
  const id = templateId('impl');
  writeSpecHtml(id, readSpecHtml(id) + '<!-- store-template-marker -->');
  assert.match(templateHtmlFor('impl'), /store-template-marker/);
});

test('templateHtmlFor falls back to the bundled shell when the store template is missing or empty', () => {
  // No seed at all → bundled shell (design uses the shared doc shell).
  const bundledDoc = readFileSync(join(ROOT, 'templates', 'spec-base-doc.html'), 'utf8');
  assert.equal(templateHtmlFor('design'), bundledDoc);
  // Seeded but emptied (a broken edit) → bundled shell, never an empty spec.
  ensureTemplates();
  writeSpecHtml(templateId('design'), '   ');
  assert.equal(templateHtmlFor('design'), bundledDoc);
});

test('a per-type bundled seed (spec-base-<type>.html) wins over the shared shell', () => {
  const research = readFileSync(join(ROOT, 'templates', 'spec-base-research.html'), 'utf8');
  const doc = readFileSync(join(ROOT, 'templates', 'spec-base-doc.html'), 'utf8');
  // research has its own shell now — not the design shell it used to clone.
  assert.equal(templateHtmlFor('research'), research);
  assert.notEqual(templateHtmlFor('research'), doc, 'research no longer clones the design shell');
  // and a fresh seed carries the research shape, not design's.
  ensureTemplates();
  assert.match(readSpecHtml(templateId('research')), /id="findings"/, 'research template has a Findings section');
});

test('the general shell is chrome plus a TL;DR and nothing else', () => {
  const general = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');
  assert.equal(templateHtmlFor('general'), general, 'general scaffolds from its own bundled shell');

  const ids = [...general.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['tldr'], 'exactly one section: the agent decides the rest');

  const tocLinks = [...general.matchAll(/<nav class="toc">[\s\S]*?<\/nav>/g)]
    .flatMap((n) => [...n[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual(tocLinks, ['tldr'], 'the TOC starts with only the TL;DR link');

  // The scaffold is what this type contributes: theme, palette, TOC chrome, status.
  const { ok, checks } = lintSpec(general);
  assert.ok(ok, `general shell lints: ${checks.filter((c) => !c.ok && !c.advisory).map((c) => c.name).join(', ')}`);
  // The plan CSS ships (a plan the agent adds must render); the plan MARKUP does not.
  assert.doesNotMatch(general, /<li\b[^>]*data-sf-(?:stage|task)/, 'no plan markup in the shell');
  assert.doesNotMatch(general, /<section\b[^>]*id="task-tracker"/, 'no tracker section in the shell');
  assert.match(general, /li\[data-sf-stage\]/, 'plan styling is present for a plan the agent adds');
});

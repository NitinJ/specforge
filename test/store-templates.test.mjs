import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { SPEC_TYPES, readMeta } from '../lib/meta.mjs';
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
  // No seed at all → bundled shell.
  const bundledDoc = readFileSync(join(ROOT, 'templates', 'spec-base-doc.html'), 'utf8');
  assert.equal(templateHtmlFor('research'), bundledDoc);
  // Seeded but emptied (a broken edit) → bundled shell, never an empty spec.
  ensureTemplates();
  writeSpecHtml(templateId('research'), '   ');
  assert.equal(templateHtmlFor('research'), bundledDoc);
});

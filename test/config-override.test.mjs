import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULTS, loadConfig } from '../lib/config.mjs';

// requiredSections is advisory config (recommended sections for the create-spec
// skill); the lint no longer enforces sections (see the spec-types design). These
// tests cover the config merge, which the skill / house-rules can still consult.

function projectConfig(cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  mkdirSync(join(dir, '.specforge'), { recursive: true });
  writeFileSync(join(dir, '.specforge', 'config.json'), JSON.stringify(cfg));
  return dir;
}

test('additionalRequiredSections appends to the default list', () => {
  const dir = projectConfig({ additionalRequiredSections: ['glossary'] });
  const cfg = loadConfig(dir);
  assert.ok(cfg.requiredSections.includes('glossary'));
  for (const s of DEFAULTS.requiredSections) assert.ok(cfg.requiredSections.includes(s));
});

test('requiredSections replaces the default list', () => {
  const dir = projectConfig({ requiredSections: ['tldr', 'overview'] });
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.requiredSections, ['tldr', 'overview']);
});

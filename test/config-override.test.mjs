import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { DEFAULTS, loadConfig } from '../lib/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LINT = join(ROOT, 'lib', 'lint-spec.mjs');
const TEMPLATE = join(ROOT, 'templates', 'spec-base.html');

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

test('the lint honors a project-added required section (create-spec contract)', () => {
  const dir = projectConfig({ additionalRequiredSections: ['glossary'] });
  const res = spawnSync(process.execPath, [LINT, TEMPLATE, '--project', dir], { encoding: 'utf8', timeout: 8000 });
  assert.ifError(res.error);
  assert.equal(res.status, 1, 'template lacks #glossary → lint must fail');
  assert.match(res.stdout, /required-sections/);
  assert.match(res.stdout, /glossary/);
});

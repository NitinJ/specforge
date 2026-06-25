import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { DEFAULTS, PALETTE_TOKENS, loadConfig } from '../lib/config.mjs';
import {
  getSectionIds,
  duplicateSectionIds,
  checkThemeContract,
  checkPalette,
  parsePlan,
  hasStructuredPlan,
} from '../lib/spec.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const DOC_TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base-doc.html'), 'utf8');

test('config: defaults expose the required section set + cadence', () => {
  assert.ok(DEFAULTS.requiredSections.includes('impl-plan'));
  assert.ok(DEFAULTS.requiredSections.includes('tradeoffs'));
  assert.equal(DEFAULTS.cadence.onePRPerStage, true);
});

test('config: project override merges over defaults and resolves specsDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  mkdirSync(join(dir, '.specforge'));
  writeFileSync(
    join(dir, '.specforge', 'config.json'),
    JSON.stringify({ port: 5000, cadence: { tddRequired: false } })
  );
  const cfg = loadConfig(dir);
  assert.equal(cfg.port, 5000); // overridden
  assert.equal(cfg.defaultTheme, 'dark'); // default kept
  assert.equal(cfg.cadence.tddRequired, false); // nested override
  assert.equal(cfg.cadence.onePRPerStage, true); // nested default kept
  assert.equal(cfg.specsDir, join(dir, 'specs')); // resolved
});

test('spec: template has the required sections with unique ids', () => {
  const ids = getSectionIds(TEMPLATE);
  for (const id of DEFAULTS.requiredSections) {
    assert.ok(ids.includes(id), `template has section #${id}`);
  }
  assert.deepEqual(duplicateSectionIds(TEMPLATE), []);
});

test('spec: template satisfies the theme contract', () => {
  const t = checkThemeContract(TEMPLATE);
  assert.equal(t.ok, true, `missing: ${t.missing.join(', ')}`);
});

test('config: exposes the canonical palette tokens', () => {
  assert.ok(PALETTE_TOKENS.includes('code'), 'code-block token is canonical');
  assert.ok(PALETTE_TOKENS.includes('panel'));
  assert.ok(PALETTE_TOKENS.includes('shadow'));
  // The lint enforces the fixed PALETTE_TOKENS set directly — not a config knob.
  assert.equal('paletteTokens' in DEFAULTS, false);
});

test('spec: both shells define every canonical palette token', () => {
  for (const [name, html] of [['impl', TEMPLATE], ['doc', DOC_TEMPLATE]]) {
    const p = checkPalette(html);
    assert.equal(p.ok, true, `${name} shell missing: ${p.missing.join(', ')}`);
  }
});

test('lint: fails when a canonical palette token is undefined', () => {
  const broken = TEMPLATE.replaceAll('--code:', '--xcode:'); // drop the code-block token
  const { ok, checks } = lintSpec(broken);
  assert.equal(ok, false);
  const c = checks.find((x) => x.name === 'palette-tokens');
  assert.equal(c.ok, false);
  assert.match(c.detail, /--code/);
});

test('spec: template plan parses into stages + tasks', () => {
  const plan = parsePlan(TEMPLATE);
  assert.ok(plan.length >= 1);
  assert.ok(plan[0].tasks.length >= 1);
  assert.equal(plan[0].tasks[0].status, 'todo');
  assert.equal(hasStructuredPlan(TEMPLATE), true);
});

test('lint: both shells pass the universal checks (no per-type section enforcement)', () => {
  for (const [name, html] of [['impl', TEMPLATE], ['doc', DOC_TEMPLATE]]) {
    const { ok, checks } = lintSpec(html);
    assert.equal(ok, true, `${name} shell: ${JSON.stringify(checks, null, 2)}`);
  }
});

test('lint: fails when no title is present', () => {
  const broken = TEMPLATE.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, '').replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '<title></title>');
  const { ok, checks } = lintSpec(broken);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'has-title').ok, false);
});

test('lint: fails when no lifecycle status is present', () => {
  const broken = TEMPLATE.replace(/\sdata-sf-spec-status\s*=\s*"[^"]*"/i, '');
  const { ok, checks } = lintSpec(broken);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'has-status').ok, false);
});

test('lint: fails on duplicate section ids', () => {
  const broken = TEMPLATE.replace('id="appendix"', 'id="tldr"');
  const { ok, checks } = lintSpec(broken);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'unique-section-ids').ok, false);
});

test('lint: fails when the theme contract is broken', () => {
  const broken = TEMPLATE.replaceAll('prefers-color-scheme', 'xxx');
  const { ok, checks } = lintSpec(broken);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'theme-contract').ok, false);
});

test('lint CLI: exits 0 on the canonical template', () => {
  const res = spawnSync(process.execPath, [join(ROOT, 'lib', 'lint-spec.mjs'), join(ROOT, 'templates', 'spec-base.html')], {
    encoding: 'utf8',
    timeout: 8000,
  });
  assert.ifError(res.error);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /lint: PASS/);
});

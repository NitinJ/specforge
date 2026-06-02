import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { DEFAULTS, loadConfig } from '../lib/config.mjs';
import {
  getSectionIds,
  duplicateSectionIds,
  checkThemeContract,
  parsePlan,
  hasStructuredPlan,
} from '../lib/spec.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const CONFIG = { requiredSections: DEFAULTS.requiredSections };

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

test('spec: template plan parses into stages + tasks', () => {
  const plan = parsePlan(TEMPLATE);
  assert.ok(plan.length >= 1);
  assert.ok(plan[0].tasks.length >= 1);
  assert.equal(plan[0].tasks[0].status, 'todo');
  assert.equal(hasStructuredPlan(TEMPLATE), true);
});

test('lint: the canonical template passes', () => {
  const { ok, checks } = lintSpec(TEMPLATE, CONFIG);
  assert.equal(ok, true, JSON.stringify(checks, null, 2));
});

test('lint: fails when a required section is missing', () => {
  const broken = TEMPLATE.replace('id="tradeoffs"', 'id="tradeoffs-renamed"');
  const { ok, checks } = lintSpec(broken, CONFIG);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'required-sections').ok, false);
});

test('lint: fails on duplicate section ids', () => {
  const broken = TEMPLATE.replace('id="appendix"', 'id="tldr"');
  const { ok, checks } = lintSpec(broken, CONFIG);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'unique-section-ids').ok, false);
});

test('lint: fails when the theme contract is broken', () => {
  const broken = TEMPLATE.replaceAll('prefers-color-scheme', 'xxx');
  const { ok, checks } = lintSpec(broken, CONFIG);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'theme-contract').ok, false);
});

test('lint: fails when the plan is not structured', () => {
  const broken = TEMPLATE.replaceAll('data-sf-task', 'data-sf-xtask');
  const { ok, checks } = lintSpec(broken, CONFIG);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'structured-plan').ok, false);
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

#!/usr/bin/env node
// SpecForge spec lint: enforce the house structure on a spec .html file.
//
// Checks (failing any is an error):
//   1. required sections present (from house rules / project config)
//   2. section ids are unique (anchors depend on stable, unique ids)
//   3. light/dark theme contract present (CSS vars, [data-theme] override,
//      prefers-color-scheme); the review layer owns applying + persisting it
//   4. the implementation plan is structured (stages → tasks with status)
//
// Usage: node lib/lint-spec.mjs <spec.html> [--project <dir>]

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.mjs';
import {
  requiredSectionStatus,
  duplicateSectionIds,
  checkThemeContract,
  hasStructuredPlan,
} from './spec.mjs';

/**
 * Run all structural checks against spec HTML.
 * @param {string} html
 * @param {{requiredSections:string[]}} config
 * @returns {{ok:boolean, checks:{name:string, ok:boolean, detail:string}[]}}
 */
export function lintSpec(html, config) {
  const checks = [];

  const req = requiredSectionStatus(html, config.requiredSections);
  checks.push({
    name: 'required-sections',
    ok: req.missing.length === 0,
    detail: req.missing.length ? `missing: ${req.missing.join(', ')}` : `${req.present.length} present`,
  });

  const dups = duplicateSectionIds(html);
  checks.push({
    name: 'unique-section-ids',
    ok: dups.length === 0,
    detail: dups.length ? `duplicates: ${dups.join(', ')}` : 'all unique',
  });

  const theme = checkThemeContract(html);
  checks.push({
    name: 'theme-contract',
    ok: theme.ok,
    detail: theme.ok ? 'light/dark OK' : `missing: ${theme.missing.join(', ')}`,
  });

  const plan = hasStructuredPlan(html);
  checks.push({
    name: 'structured-plan',
    ok: plan,
    detail: plan ? 'stages + tasks found' : 'no data-sf-stage/data-sf-task with status',
  });

  return { ok: checks.every((c) => c.ok), checks };
}

function main(argv) {
  const args = argv.slice(2);
  let file = null;
  let project = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') project = args[++i];
    else if (!file) file = args[i];
  }
  if (!file) {
    console.error('usage: lint-spec.mjs <spec.html> [--project <dir>]');
    process.exit(2);
  }
  const config = loadConfig(project || dirname(file));
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const { ok, checks } = lintSpec(html, config);
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);
  }
  console.log(ok ? '\nlint: PASS' : '\nlint: FAIL');
  process.exit(ok ? 0 : 1);
}

// Run as CLI only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}

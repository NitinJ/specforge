#!/usr/bin/env node
// SpecForge spec lint: the universal basics every spec must satisfy, regardless
// of type (design / research / design-impl / impl). Per-type section skeletons
// are recommended — the create-spec skill authors them, adapting to the problem —
// and are NOT enforced here (see the spec-types design: recommended, not enforced).
//
// Checks (failing any is an error):
//   1. a title is present (<h1> or <title> with text)
//   2. a lifecycle status is present (data-sf-spec-status)
//   3. section ids are unique (anchors depend on stable, unique ids)
//   4. light/dark theme contract present (CSS vars, [data-theme] override,
//      prefers-color-scheme); the review layer owns applying + persisting it
//   5. the canonical palette tokens are all defined (--bg/--panel/--ink/--code/…),
//      so the review-layer theme variants override one known set, not a dialect
//
// Usage: node lib/lint-spec.mjs <spec.html> [--project <dir>]   (--project is ignored)

import { readFileSync } from 'node:fs';
import { duplicateSectionIds, checkThemeContract, checkPalette } from './spec.mjs';

const RE_TITLE = /<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>|<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i;
const RE_STATUS = /data-sf-spec-status\s*=\s*["'][^"']+["']/i;

/**
 * Run the universal structural checks against spec HTML.
 * @param {string} html
 * @returns {{ok:boolean, checks:{name:string, ok:boolean, detail:string}[]}}
 */
export function lintSpec(html) {
  const checks = [];

  const titleOk = RE_TITLE.test(html);
  checks.push({ name: 'has-title', ok: titleOk, detail: titleOk ? 'present' : 'no <h1>/<title> with text' });

  const statusOk = RE_STATUS.test(html);
  checks.push({ name: 'has-status', ok: statusOk, detail: statusOk ? 'present' : 'no data-sf-spec-status' });

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

  const palette = checkPalette(html);
  checks.push({
    name: 'palette-tokens',
    ok: palette.ok,
    detail: palette.ok ? 'canonical tokens defined' : `missing: ${palette.missing.map((t) => '--' + t).join(', ')}`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

function main(argv) {
  const args = argv.slice(2);
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') { i++; continue; } // tolerated for back-compat; unused
    if (!file) file = args[i];
  }
  if (!file) {
    console.error('usage: lint-spec.mjs <spec.html> [--project <dir>]');
    process.exit(2);
  }
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }
  const { ok, checks } = lintSpec(html);
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

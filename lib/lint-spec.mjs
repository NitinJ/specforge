#!/usr/bin/env node
// SpecForge spec lint: the universal basics every spec must satisfy, regardless
// of type (design / research / design-impl / impl). Per-type section skeletons
// are recommended — the create-spec skill authors them, adapting to the problem —
// and are NOT enforced here (see the spec-types design: recommended, not enforced).
//
// This is now a wrapper over the rule registry (lib/rules/). The eight checks it
// has always run live in lib/rules/structural.mjs as check-rules with the same
// ids, severities and detail strings, and this file reports them in the shape it
// always has. Five skills and eight test files depend on that shape, so the
// promise is that a caller cannot tell the difference.
//
// For the full picture — the judged rules as well as the mechanical ones — use
// `specforge verify <id>`, which runs everything and hands the agent what a
// function cannot answer.
//
// Checks (failing any non-advisory one is an error):
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
import { STRUCTURAL_RULES } from './rules/structural.mjs';
import { runCheckRules } from './rules/run.mjs';
import { isMain } from './is-main.mjs';

// Re-exported from its own module now that the registry imports it too. Callers
// have always found it here.
export { checkLanguage } from './spec-language.mjs';

/**
 * Run the universal structural checks against spec HTML.
 *
 * The returned `checks` carry `advisory` only when true, and omit rules that do
 * not apply to this spec (`spec-components` reports nothing on the pre-library
 * specs). Both are the shape callers already handle.
 *
 * @param {string} html
 * @returns {{ok:boolean, checks:{name:string, ok:boolean, detail:string, advisory?:boolean}[]}}
 */
export function lintSpec(html) {
  const checks = runCheckRules(STRUCTURAL_RULES, html).map((v) => ({
    name: v.id,
    ok: v.ok,
    ...(v.severity === 'advisory' ? { advisory: true } : {}),
    detail: v.detail,
  }));
  return { ok: checks.filter((c) => !c.advisory).every((c) => c.ok), checks };
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
    const mark = c.ok ? '✓' : c.advisory ? '⚠' : '✗';
    console.log(`${mark} ${c.name} — ${c.detail}`);
  }
  console.log(ok ? '\nlint: PASS' : '\nlint: FAIL');
  process.exit(ok ? 0 : 1);
}

// Run as CLI only when invoked directly (not when imported by tests).
if (isMain(import.meta.url)) {
  main(process.argv);
}

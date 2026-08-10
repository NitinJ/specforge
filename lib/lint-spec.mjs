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

// Commentability advisory (T7): the review layer only anchors comments to a known
// block set (h1-6,p,li,tr,td,th,pre,blockquote,figure and the .panel/.card/
// .callout/.stat/.q/.bar/.ns classes). Generated deck/card markup often traps
// text directly inside a bare <div>, which is then un-commentable. This flags a
// <div ...>text pattern whose class is not one of the commentable ones. Advisory
// only — it never fails the lint.
const COMMENTABLE_DIV_CLASSES = new Set(['panel', 'card', 'callout', 'stat', 'q', 'bar', 'ns']);

// Spec-language advisory: the mechanically detectable slice of the language
// contract (references/spec-language.md). It can only see surface patterns —
// aphorism, register and unlabelled sentences are the author's job — so it
// reports and never fails, matching the contract's own "report failures, do not
// silently fix".
// Each rule must at minimum catch the forms the contract itself names as bad —
// a spec that quotes the contract's own examples and is told it is clean makes
// the check worse than useless.
const LANGUAGE_RULES = [
  { name: 'em dash', re: /—/g, fix: 'use a colon, semicolon, parentheses, or split the sentence' },
  {
    name: 'attention-curating phrase',
    re: /\b(worth noting|it is worth|the finding that matters|known risk|note that|importantly|interestingly|crucially)\b/gi,
    fix: 'rank by a severity field, not an adjective',
  },
  {
    name: 'precision theatre',
    // Bare ranges ("10 to 20", "typically 1 to 3") and unquantified amounts.
    re: /\b(\d+\s+to\s+\d+|typically \d|roughly \d|a handful of|a bounded number of|several days|most)\b/gi,
    fix: 'give a parameter with default, range and unit, or mark it unknown',
  },
  {
    name: 'unfalsifiable superlative',
    re: /\bthe (cheapest|fastest|slowest|hardest|easiest|biggest|largest|smallest|best|worst|most \w+)\b/gi,
    fix: 'attach a criterion and a number, or cut it',
  },
  {
    name: 'hedged decision',
    re: /\b(probably|presumably|we might want|arguably|likely the same)\b/gi,
    fix: 'either decide it, or record an open question with an id',
  },
];

/** Strip markup, CSS and scripts so prose rules only see prose. */
function proseOf(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')   // code samples are exempt
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** @returns {{name:string, count:number, fix:string}[]} rules that fired */
export function checkLanguage(html) {
  const prose = proseOf(html);
  return LANGUAGE_RULES
    .map((r) => ({ name: r.name, count: (prose.match(r.re) || []).length, fix: r.fix }))
    .filter((r) => r.count > 0);
}
const COMMENTABILITY_WARN_THRESHOLD = 2;

function countTrappedContentDivs(html) {
  let n = 0;
  const re = /<div\b([^>]*)>\s*[^<\s]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const cls = (m[1].match(/class\s*=\s*["']([^"']*)["']/i) || [, ''])[1];
    if (!cls.split(/\s+/).some((c) => COMMENTABLE_DIV_CLASSES.has(c))) n++;
  }
  return n;
}

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

  // Advisory: does not fail the lint (see COMMENTABILITY_WARN_THRESHOLD note).
  const trapped = countTrappedContentDivs(html);
  checks.push({
    name: 'commentability',
    ok: trapped <= COMMENTABILITY_WARN_THRESHOLD,
    advisory: true,
    detail: trapped === 0
      ? 'all content in commentable blocks'
      : `${trapped} div(s) hold text directly — wrap it in a <p>/<li> or a .card/.panel/.stat/.callout so reviewers can comment on it`,
  });

  // Advisory: the language contract's mechanical subset (references/spec-language.md).
  const lang = checkLanguage(html);
  checks.push({
    name: 'spec-language',
    ok: lang.length === 0,
    advisory: true,
    detail: lang.length === 0
      ? 'no banned patterns found'
      : lang.map((r) => `${r.count}× ${r.name} (${r.fix})`).join('; '),
  });

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
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}

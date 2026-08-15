// The mechanically detectable slice of the language contract
// (references/spec-language.md).
//
// Lifted out of lib/lint-spec.mjs unchanged so the rule registry can import it
// without importing the lint, which now imports the registry. `checkLanguage` is
// still re-exported from lint-spec.mjs, which is where callers have always found
// it.
//
// It can only see surface patterns. Aphorism, register and unlabelled sentences
// are the author's job, which is why it reports and never fails, matching the
// contract's own "report failures, do not silently fix".
//
// Each rule must at minimum catch the forms the contract itself names as bad — a
// spec that quotes the contract's own examples and is told it is clean makes the
// check worse than useless.

export const LANGUAGE_RULES = [
  { name: 'em dash', re: /—/g, fix: 'use a colon, semicolon, parentheses, or split the sentence' },
  {
    name: 'attention-curating phrase',
    re: /\b(worth noting|it is worth|the finding that matters|known risk|note that|importantly|interestingly|crucially)\b/gi,
    fix: 'rank by a severity field, not an adjective',
  },
  {
    name: 'precision theatre',
    // Bare ranges ("10 to 20", "typically 1 to 3") and unquantified amounts.
    // Bare "most" only counts as a vague quantifier ("most requests"). "at most
    // one session" is a hard bound, which is what the contract asks for, and
    // "the most X" is a superlative the rule below owns; both are excluded.
    re: /\b(\d+\s+to\s+\d+|typically \d|roughly \d|a handful of|a bounded number of|several days|(?<!\b(?:at|the) )most)\b/gi,
    fix: 'give a parameter with default, range and unit, or mark it unknown',
  },
  {
    name: 'unfalsifiable superlative',
    // The leading lookahead exempts two terms of art by name: "the best-effort
    // fallback" and "the worst-case latency" describe a technique rather than a
    // ranking, and both are common in specs. Exempting the hyphen itself would
    // be wrong, since "the most cost-effective option" and "the best-known
    // technique" are exactly the ranking claims the rule exists to catch.
    re: /\bthe (?!best-effort\b|worst-case\b)(cheapest|fastest|slowest|hardest|easiest|biggest|largest|smallest|best|worst|most \w+)\b/gi,
    fix: 'attach a criterion and a number, or cut it',
  },
  {
    name: 'hedged decision',
    re: /\b(probably|presumably|we might want|arguably|likely the same)\b/gi,
    fix: 'either decide it, or record an open question with an id',
  },
];

/**
 * Strip markup, CSS and scripts so prose rules only see prose.
 *
 * The final pass collapses every whitespace run to one space, which is what
 * lets multi-word rules work at all: in real specs a phrase is routinely split
 * by a line break or an inline tag ("worth\n  noting", "at <em>most</em> one"),
 * and without this every such phrase reads as unmatched.
 */
export function proseOf(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')   // code samples are exempt
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')  // an entity space is a space
    .replace(/\s+/g, ' ');
}

/** @returns {{name:string, count:number, fix:string}[]} rules that fired */
export function checkLanguage(html) {
  const prose = proseOf(html);
  return LANGUAGE_RULES
    .map((r) => ({ name: r.name, count: (prose.match(r.re) || []).length, fix: r.fix }))
    .filter((r) => r.count > 0);
}

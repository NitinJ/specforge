#!/usr/bin/env node
// What kinds of spec exist, for whoever is about to pick one.
//
// The create skill reads this before settling on one of the six built-ins: a
// kind the user added from the configuration page carries a "when to use" line
// they wrote, and a kind made for exactly this request beats any general-purpose
// one. Without it the skill would go on choosing from a list frozen when it was
// written.
//
// Usage:
//   node lib/spec-types-cli.mjs           # human-readable
//   node lib/spec-types-cli.mjs --json    # the records, for a caller to parse
//
// Spec 45395008a2, task 5.2.

import { specTypes, specType } from './spec-types.mjs';

const records = specTypes().map((slug) => specType(slug));

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ types: records }, null, 2)}\n`);
} else {
  const shell = (t) => (t.shell === 'impl' ? 'carries an implementation plan' : 'a document');
  const lines = [];
  const builtin = records.filter((t) => t.builtin);
  const custom = records.filter((t) => !t.builtin);

  lines.push('Built in:');
  for (const t of builtin) lines.push(`  ${t.slug.padEnd(14)} ${shell(t)}`);

  if (custom.length) {
    lines.push('');
    lines.push('Added by you:');
    for (const t of custom) {
      lines.push(`  ${t.slug.padEnd(14)} ${shell(t)}`);
      // The line that decides whether this type is the right one. Indented under
      // its slug rather than tabulated, because it is a sentence and a column
      // would truncate it.
      if (t.whenToUse) lines.push(`      when to use: ${t.whenToUse}`);
    }
  } else {
    lines.push('');
    lines.push('No types have been added. The configuration page can add one:');
    lines.push('  /settings?tab=templates');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

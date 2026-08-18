// The language contract SpecForge ships, as text the configuration pane can
// show.
//
// The contract is prose in the plugin (`references/spec-language.md`), read by
// the authoring skills. A user's authoring direction is an extension of it, not
// a replacement (spec 094abd0b9d, axis A), so the pane renders the contract
// beside the box rather than into it: a box prefilled with the contract would
// make every save an override of rules the user never meant to take ownership
// of, and the store's 4,000-character cap would then truncate the tail of a
// document that is already 3,300 characters long.
//
// Read from disk on demand rather than inlined, so there is one copy of the
// contract and the skills and the pane cannot disagree about what it says.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'spec-language.md');

let cached = null;

/**
 * The shipped contract, verbatim.
 *
 * An unreadable file answers with an empty string rather than throwing: the
 * pane showing no reference text is a worse page, and a settings route that
 * 500s because a doc file moved is a broken product.
 *
 * @returns {string}
 */
export function shippedLanguageContract() {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(CONTRACT, 'utf8');
  } catch {
    cached = '';
  }
  return cached;
}

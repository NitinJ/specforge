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

import { readPrompts } from './store-prompts.mjs';

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

/**
 * The contract in force: what an agent writing spec prose has to follow.
 *
 * This is the one function anything handing rules to an agent may call. The
 * shipped file used to be read directly by the authoring skills, which made the
 * Language tab a lie the moment it became editable: deleting a rule from the
 * box left the skill still reading that rule out of the file, because an
 * absence is not a disagreement and nothing was there to win against it.
 *
 * Two stored shapes, and the difference matters. A store written since the tab
 * held the contract carries the whole thing (`languageMode: 'contract'`), so it
 * IS the answer. A store written before it carries a short direction that was
 * added on top of the shipped rules, so it is appended to them, last, where it
 * still wins by being the more specific instruction. Presenting that direction
 * alone would delete the rest of the contract from a store whose owner only
 * ever wrote two sentences.
 *
 * @returns {string}
 */
export function languageContract() {
  const { language, languageMode } = readPrompts();
  if (!language) return shippedLanguageContract();
  if (languageMode === 'contract') return language;
  const shipped = shippedLanguageContract();
  return shipped ? `${shipped}\n\n## This store's own direction\n\n${language}` : language;
}

/** Is the contract in force the shipped one, unedited? */
export function languageIsDefault() {
  return !readPrompts().language;
}

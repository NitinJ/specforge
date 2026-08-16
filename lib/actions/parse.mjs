// Reading actions back out of a comment body.
//
// This is the seam where the browser's half of the feature meets the agent's.
// The menu writes `@visualize ` into the composer, the audience chip prepends
// `@agent`, and what arrives here is an ordinary comment that happens to name an
// action.
//
// Built on mentionNames() rather than a regex of its own, for one property: a
// mention inside code is quotation rather than addressing. A spec that documents
// its own syntax must not queue work against itself, and mentions.mjs already
// carries that rule for `@agent`. An action id is the same kind of token and
// gets the same treatment for free.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

import { mentionNames, stripCode } from '../mentions.mjs';
import { actionById } from './all.mjs';

/** Action ids named in a body, in the order written, without repeats. */
export function actionIdsIn(body) {
  const out = [];
  for (const name of mentionNames(body)) {
    if (actionById(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * What is left of a body once every mention is taken out.
 *
 * This is the qualifier: the fact only the reader holds, typed onto the end of
 * the seeded action. `verify_against_code` and `fix_the_naming` cannot run
 * without one, and the difference between having it and not is the difference
 * between doing the work and guessing at it.
 */
export function detailIn(body) {
  return stripCode(body)
    .replace(/@[a-z0-9_-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The actions a comment asks for, each with its standing instruction and
 * whatever the reader typed alongside it.
 *
 * The detail is the same string on every action in the comment. Splitting one
 * qualifier between two actions would need to know which words belong to which,
 * and nothing in the body says: "@visualize @go_deeper on the retry path"
 * applies to both.
 *
 * @param {string} body
 * @returns {object[]} action records with `detail` added
 */
export function parseActions(body) {
  const detail = detailIn(body);
  return actionIdsIn(body).map((id) => ({ ...actionById(id), detail }));
}

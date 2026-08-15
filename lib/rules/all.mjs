// The rule list for one spec type: the global floor, plus that type's template.
//
// Kept apart from ./index.mjs because this is the one place in the rules layer
// that reads the store. index.mjs stays pure so the merge logic can be tested
// without a store, and so template-blocks.mjs can import it without dragging the
// filesystem in behind it.

import { ALL_GLOBAL_RULES } from './global.mjs';
import { mergeRules, duplicateRuleIds } from './index.mjs';
import { templateRules } from '../store-templates.mjs';

/**
 * Every rule a spec of `type` is judged against, in report order.
 *
 * The global list is the floor and a template cannot delete from it, only
 * change how hard a rule bites — including to `off`, which is how a deck gets
 * to keep the line a design spec may not.
 *
 * @param {string} type
 * @returns {object[]} rule records
 */
export function allRules(type) {
  return mergeRules(ALL_GLOBAL_RULES, templateRules(type));
}

/**
 * Ids a template lists more than once.
 *
 * Checked on the template's RAW list, before the merge. The merge is last-wins
 * by id, so asking the merged list is asking a list that has already had the
 * duplicate erased: it can never report one. The error being reported is a
 * rule-authoring error — writing the same id twice in one block silently stops
 * the first one being checked — and it only exists before the merge.
 *
 * @param {string} type
 * @returns {string[]}
 */
export function duplicateTemplateRuleIds(type) {
  return duplicateRuleIds(templateRules(type));
}

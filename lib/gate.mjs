// Pre-implementation gate (design §8.3). A spec may not move to implementation
// until it is structurally sound AND its open questions are resolved. Reuses the
// lint (required sections, unique ids, theme contract, structured plan) and adds
// the open-questions check.

import { lintSpec } from './lint-spec.mjs';
import { sectionBody } from './spec.mjs';

/** Count unresolved open questions (`<li data-sf-q="open">`). */
export function openQuestionsUnresolved(html) {
  const body = sectionBody(html, 'open-questions');
  if (!body) return 0;
  return (body.match(/data-sf-q="open"/g) || []).length;
}

/**
 * Run the pre-implementation gate.
 * @returns {{ok:boolean, checks:{name:string, ok:boolean, detail:string}[]}}
 */
export function checkGate(html, config) {
  const checks = lintSpec(html, config).checks.slice();
  const unresolved = openQuestionsUnresolved(html);
  checks.push({
    name: 'open-questions-resolved',
    ok: unresolved === 0,
    detail: unresolved ? `${unresolved} unresolved` : 'all resolved',
  });
  return { ok: checks.every((c) => c.ok), checks };
}

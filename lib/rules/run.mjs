// Running rules. One place, so the lint and the verifier cannot disagree about
// what a rule's answer means.
//
// A check-rule returns `{ok, detail}`, or `{applies: false}` when it has nothing
// to say about this spec. A rule that throws is reported as failing with the
// error as its detail rather than taking the process down: a broken rule should
// name itself, not stop every other rule from running.

import { isCheckRule } from './index.mjs';

/**
 * Answer every check-rule in `rules` against `html`.
 *
 * Ask-rules are skipped here by construction, because Node has no way to answer
 * them. The verifier collects those separately as `pending`.
 *
 * @param {object[]} rules
 * @param {string} html
 * @returns {{id:string, ok:boolean, severity:string, detail:string, fix:string}[]}
 */
export function runCheckRules(rules, html) {
  const out = [];
  for (const rule of rules) {
    if (!isCheckRule(rule)) continue;
    let result;
    try {
      result = rule.check(html);
    } catch (e) {
      out.push({
        id: rule.id,
        ok: false,
        severity: rule.severity,
        detail: `rule threw: ${e.message}`,
        fix: rule.fix,
      });
      continue;
    }
    if (result && result.applies === false) continue;
    out.push({
      id: rule.id,
      ok: Boolean(result && result.ok),
      severity: rule.severity,
      detail: (result && result.detail) || '',
      fix: rule.fix,
    });
  }
  return out;
}

// The quality gate: a spec is not finished until it passes.
//
// Two states, PASS and FAIL. On FAIL the report names every rule the spec fails
// and what to do about each. The agent fixes them, runs it again, and repeats
// until PASS. That loop is the whole design; a check whose result nobody has to
// act on is a report, not a gate.
//
// Rules come in two kinds and both can fail the gate. A `check` rule is answered
// here, by a function. An `ask` rule is answered by the agent reading the spec,
// which it reports back with `judged` on the next run. Until it does, the rule is
// failing — not "pending", not a resting place. An unjudged rule counts against
// you exactly like a broken one, because otherwise nobody judges it.
//
// `judged` is per-run and nothing is written down (D2). It is the agent's word,
// which is what every other instruction in a skill rests on; what matters is
// that create-spec now has a condition to reach and cannot hand over short of it.

import { allRules, duplicateTemplateRuleIds } from './rules/all.mjs';
import { runCheckRules } from './rules/run.mjs';
import { isCheckRule } from './rules/index.mjs';

/** 0 when the gate passes, 1 when it does not. A harness gates on this. */
export const EXIT = { PASS: 0, FAIL: 1 };

/**
 * Run the gate.
 *
 * @param {string} html the spec
 * @param {string} type the spec type, which decides the rule list
 * @param {{judged?: string[]}} [o] rule ids the agent has judged and found
 *   satisfied. Per-run only: nothing is stored, so the next run asks again.
 * @returns {{pass:boolean, exit:number, type:string, failing:object[],
 *            advisories:object[], passed:string[], judged:string[],
 *            unknownJudged:string[], duplicates:string[]}}
 */
export function verifySpec(html, type, { judged = [] } = {}) {
  const rules = allRules(type);
  // From the template's raw list, not from `rules`. The merge is last-wins by
  // id, so `rules` has already had any duplicate erased and asking it would
  // always report none.
  const duplicates = duplicateTemplateRuleIds(type);

  const byId = new Map(rules.map((r) => [r.id, r]));
  const claimed = [...new Set(judged)];
  // A judged id nothing recognises is reported rather than ignored: it is either
  // a typo or a rule that has been renamed, and silently accepting it would let
  // the gate pass on a rule nobody actually judged.
  const unknownJudged = claimed.filter((id) => !byId.has(id));
  const judgedSet = new Set(claimed.filter((id) => byId.has(id)));

  const verdicts = runCheckRules(rules, html);
  const answered = new Map(verdicts.map((v) => [v.id, v]));

  const failing = [];
  const advisories = [];
  const passed = [];

  for (const rule of rules) {
    const verdict = answered.get(rule.id);
    if (isCheckRule(rule)) {
      // A check-rule that abstained had nothing to say about this spec.
      if (!verdict) continue;
      if (verdict.ok) { passed.push(rule.id); continue; }
      (rule.severity === 'blocking' ? failing : advisories).push({
        id: rule.id, kind: 'check', severity: rule.severity, why: verdict.detail, fix: rule.fix,
      });
      continue;
    }
    if (judgedSet.has(rule.id)) { passed.push(rule.id); continue; }
    (rule.severity === 'blocking' ? failing : advisories).push({
      id: rule.id, kind: 'judge', severity: rule.severity, why: rule.ask, fix: rule.fix,
    });
  }

  const pass = failing.length === 0 && unknownJudged.length === 0;
  return {
    pass,
    exit: pass ? EXIT.PASS : EXIT.FAIL,
    type,
    failing,
    advisories,
    passed,
    judged: [...judgedSet],
    unknownJudged,
    duplicates,
  };
}

/**
 * The report, for a human or an agent reading a terminal.
 *
 * On FAIL it is a work list and nothing else: what is wrong, and what to do.
 * The passes are one line at the end, because a report that opens with thirty
 * ticks buries the two lines that need action.
 */
export function formatReport(result) {
  const lines = [];

  if (result.duplicates.length) {
    lines.push(`! this type's template lists ${result.duplicates.join(', ')} twice. The later one wins, so the earlier stopped being checked. Delete one.`);
    lines.push('');
  }

  if (result.unknownJudged.length) {
    lines.push(`! --judged names ${result.unknownJudged.join(', ')}, which is not a rule for this type. Check the spelling.`);
    lines.push('');
  }

  const toFix = result.failing.filter((f) => f.kind === 'check');
  const toJudge = result.failing.filter((f) => f.kind === 'judge');

  if (toFix.length) {
    lines.push(`FIX — ${toFix.length} rule(s) the spec breaks:`);
    for (const f of toFix) {
      lines.push(`  ✗ ${f.id} — ${f.why}`);
      if (f.fix) lines.push(`      ${f.fix}`);
    }
    lines.push('');
  }

  if (toJudge.length) {
    lines.push(`JUDGE — ${toJudge.length} rule(s) no function can answer. Read the spec against each.`);
    lines.push(`  Satisfied ones go back on the next run: --judged ${toJudge.map((f) => f.id).join(',')}`);
    for (const f of toJudge) {
      lines.push(`  ? ${f.id} — ${f.why}`);
      if (f.fix) lines.push(`      ${f.fix}`);
    }
    lines.push('');
  }

  if (result.advisories.length) {
    lines.push(`ADVISORY — reported, does not hold up the gate:`);
    for (const a of result.advisories) lines.push(`  ⚠ ${a.id} — ${a.why}`);
    lines.push('');
  }

  if (result.passed.length) lines.push(`PASSED — ${result.passed.length} rule(s): ${result.passed.join(', ')}`);

  lines.push('');
  lines.push(result.pass
    ? `verify: PASS (${result.type})`
    : `verify: FAIL (${result.type}) — ${toFix.length} to fix, ${toJudge.length} to judge`);
  return lines.join('\n');
}

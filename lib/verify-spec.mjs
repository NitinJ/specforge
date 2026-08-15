// Verify a spec against its type's rules.
//
// The runner answers everything a function can and reports the rest as PENDING
// rather than as passing. That third state is the point. An ask-rule nobody has
// judged is not a rule that passed; reporting it as one manufactures assurance,
// which is the single failure mode that would make this whole system worse than
// having no verification at all (D5).
//
// So `ok` is false while anything blocking has failed, and is also false while
// anything blocking is still pending. A green verdict means every blocking rule
// was actually answered.

import { allRules } from './rules/all.mjs';
import { runCheckRules } from './rules/run.mjs';
import { isCheckRule, duplicateRuleIds } from './rules/index.mjs';

/**
 * @param {string} html the spec
 * @param {string} type the spec type, which decides the rule list
 * @returns {{ok:boolean, type:string, verdicts:object[], pending:object[],
 *            failed:object[], duplicates:string[]}}
 */
export function verifySpec(html, type) {
  const rules = allRules(type);
  const duplicates = duplicateRuleIds(rules);

  const verdicts = runCheckRules(rules, html);
  const answered = new Set(verdicts.map((v) => v.id));

  // Everything a function could not answer, which is the agent's work list.
  // A check-rule that abstained (`applies:false`) is neither answered nor
  // pending: it had nothing to say about this spec, and inventing a judgement
  // for it would be inventing work.
  const pending = rules
    .filter((r) => !isCheckRule(r) && !answered.has(r.id))
    .map((r) => ({ id: r.id, severity: r.severity, title: r.title, ask: r.ask, fix: r.fix }));

  const failed = verdicts.filter((v) => !v.ok && v.severity === 'blocking');
  const blockingPending = pending.filter((p) => p.severity === 'blocking');

  return {
    ok: failed.length === 0 && blockingPending.length === 0,
    type,
    verdicts,
    pending,
    failed,
    duplicates,
  };
}

/**
 * The report as text, for a human reading it in a terminal.
 *
 * Failures first, then what is still pending, then the passes. A report that
 * leads with 30 ticks buries the two lines that need action.
 */
export function formatReport(result) {
  const lines = [];
  const mark = (v) => (v.ok ? '✓' : v.severity === 'advisory' ? '⚠' : '✗');

  if (result.duplicates.length) {
    lines.push(`! duplicate rule ids: ${result.duplicates.join(', ')} — the later one wins and the earlier stopped being checked`);
    lines.push('');
  }

  const failed = result.verdicts.filter((v) => !v.ok);
  if (failed.length) {
    lines.push('FAILED');
    for (const v of failed) {
      lines.push(`  ${mark(v)} ${v.id} — ${v.detail}`);
      if (v.fix) lines.push(`      fix: ${v.fix}`);
    }
    lines.push('');
  }

  if (result.pending.length) {
    lines.push(`PENDING — ${result.pending.length} rule(s) a function cannot answer. Judge each against the spec.`);
    for (const p of result.pending) {
      lines.push(`  ? ${p.id}${p.severity === 'advisory' ? ' (advisory)' : ''} — ${p.ask}`);
      if (p.fix) lines.push(`      fix: ${p.fix}`);
    }
    lines.push('');
  }

  const passed = result.verdicts.filter((v) => v.ok);
  if (passed.length) lines.push(`PASSED — ${passed.map((v) => v.id).join(', ')}`);

  lines.push('');
  lines.push(
    result.ok
      ? `verify: PASS (${result.type})`
      : `verify: NOT DONE (${result.type}) — ${result.failed.length} failing, ${result.pending.filter((p) => p.severity === 'blocking').length} blocking judgement(s) outstanding`,
  );
  return lines.join('\n');
}

// The rule registry: what a rule is, and how a spec type's list is assembled.
//
// A rule is answered one of two ways and never both. `check` is a function over
// the spec HTML, answered by Node, free and offline. `ask` is a sentence of
// English, answered by whoever is reading. The split is a property of the rule,
// not a preference: a rule is `check` when the answer is in the markup and `ask`
// when it is in the meaning, and a regex for the second kind passes on prose
// engineered to pass it, which is worse than no check.
//
// Node never calls a model. It cannot: SpecForge ships with zero runtime
// dependencies and has to run under any harness. Everything here falls out of
// that constraint.

/** A rule's severity. `off` is how a template disables an inherited rule. */
export const SEVERITIES = ['blocking', 'advisory', 'off'];

/**
 * Normalise a rule record and fail loudly on a malformed one.
 *
 * Rules are authored in two places — this repo and a template's prose — and a
 * typo in either should name itself at load time rather than silently producing
 * a rule that never fires.
 *
 * @param {object} r
 * @returns {{id:string, scope:string, severity:string, title:string,
 *            check:Function|null, ask:string|null, fix:string}}
 */
export function defineRule(r) {
  if (!r || typeof r.id !== 'string' || !r.id.trim()) {
    throw new Error('rule: id is required');
  }
  const hasCheck = typeof r.check === 'function';
  const hasAsk = typeof r.ask === 'string' && r.ask.trim().length > 0;
  if (hasCheck && hasAsk) throw new Error(`rule ${r.id}: has both check and ask; a rule is answered one way`);
  if (!hasCheck && !hasAsk) throw new Error(`rule ${r.id}: has neither check nor ask`);
  const severity = r.severity === undefined ? 'blocking' : r.severity;
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`rule ${r.id}: unknown severity ${JSON.stringify(severity)}`);
  }
  return {
    id: r.id,
    scope: r.scope || 'all',
    severity,
    title: r.title || r.id,
    check: hasCheck ? r.check : null,
    ask: hasAsk ? r.ask.trim() : null,
    fix: r.fix || '',
  };
}

/** True when the rule is answered by Node rather than by the agent. */
export function isCheckRule(rule) {
  return typeof rule.check === 'function';
}

/**
 * Merge a base list with a template's list, by id. The template wins.
 *
 * An override is raw, not a full rule record, because the useful case carries
 * almost nothing: `<li data-sf-rule="no-aphorisms" data-sf-severity="off">` is
 * an id and a severity. So an override supplies only what it changes, and
 * everything it leaves out is inherited:
 *
 *   {id, severity}       change how hard an inherited rule bites, nothing else
 *   {id, ask}            restate an inherited rule in this type's words
 *   {id, ask, severity}  a rule this type has and others do not
 *
 * Prose beats a function: a template that writes a sentence over a check-rule is
 * asking for that sentence to be judged, so the inherited `check` is dropped.
 * Anything else would run the old function and report the new sentence.
 *
 * @param {object[]} base rule records from defineRule
 * @param {object[]} overrides raw {id, severity?, ask?, title?, fix?}
 * @returns {object[]} base order, template-only rules appended, `off` removed
 */
export function mergeRules(base, overrides) {
  const bySlot = new Map();
  for (const rule of base) bySlot.set(rule.id, rule);

  for (const over of overrides) {
    const prev = bySlot.get(over.id);
    if (!prev) {
      // A rule a template introduces is always prose; it has no way to ship a
      // function. defineRule refuses it if the sentence is missing.
      bySlot.set(over.id, defineRule({ ...over, scope: over.scope || 'all' }));
      continue;
    }
    // Validated here as well as in defineRule. An override that matches an
    // existing id never goes through defineRule, so without this a typo
    // ("advisroy") would set a severity nothing recognises: the rule would not
    // be `off`, would not be `blocking`, and would quietly stop being counted.
    if (over.severity !== undefined && !SEVERITIES.includes(over.severity)) {
      throw new Error(`rule ${over.id}: unknown severity ${JSON.stringify(over.severity)}`);
    }
    const restated = typeof over.ask === 'string' && over.ask.trim().length > 0;
    bySlot.set(over.id, {
      ...prev,
      severity: over.severity === undefined ? prev.severity : over.severity,
      ask: restated ? over.ask.trim() : prev.ask,
      check: restated ? null : prev.check,
      title: over.title || prev.title,
      fix: over.fix || prev.fix,
    });
  }

  return [...bySlot.values()].filter((r) => r.severity !== 'off');
}

/**
 * Ids that appear more than once in a list.
 *
 * Two rules with the same id inside ONE list is a rule-authoring error: the
 * override mechanism gives the last one the slot, so the earlier one silently
 * stops being checked. Reported rather than resolved.
 */
export function duplicateRuleIds(rules) {
  const seen = new Set();
  const dups = new Set();
  for (const r of rules) {
    if (seen.has(r.id)) dups.add(r.id);
    seen.add(r.id);
  }
  return [...dups];
}

/** Rules that apply to `type`: scope 'all', or scope naming the type. */
export function forType(rules, type) {
  return rules.filter((r) => r.scope === 'all' || r.scope === type);
}

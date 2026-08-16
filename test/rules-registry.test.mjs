// The registry, and the promise that nothing observable changed.
//
// lintSpec is imported by five skills and eight test files. Stage 1 moves its
// eight checks into rule records and reimplements it over them, which is only
// safe if the output is identical. The golden test below pins the check names,
// their order and their advisory flags to what they are on main, so a caller
// cannot tell the refactor happened.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSpec } from '../lib/lint-spec.mjs';
import { defineRule, mergeRules, duplicateRuleIds, forType, isCheckRule } from '../lib/rules/index.mjs';
import { runCheckRules } from '../lib/rules/run.mjs';
import { STRUCTURAL_RULES } from '../lib/rules/structural.mjs';
import { cleanSpec, specWith } from './helpers/spec-corpus.mjs';

// What lintSpec returned on main, in order. A change here is a breaking change
// to five skills, so it should be deliberate enough to edit this list.
const LINT_CHECKS_ON_MAIN = [
  { name: 'has-title', advisory: false },
  { name: 'has-status', advisory: false },
  { name: 'unique-section-ids', advisory: false },
  { name: 'theme-contract', advisory: false },
  { name: 'palette-tokens', advisory: false },
  { name: 'commentability', advisory: true },
  { name: 'spec-components', advisory: true },
  { name: 'spec-language', advisory: true },
];

/** The corpus spec, opted into the component library so spec-components reports. */
function librarySpec() {
  return cleanSpec().replace('<html>', '<html data-sf-components="1">');
}

test('lintSpec returns the same checks, in the same order, with the same flags', () => {
  const { checks } = lintSpec(librarySpec());
  assert.deepEqual(
    checks.map((c) => ({ name: c.name, advisory: Boolean(c.advisory) })),
    LINT_CHECKS_ON_MAIN,
  );
});

test('a pre-library spec omits spec-components rather than reporting it clean', () => {
  const names = lintSpec(cleanSpec()).checks.map((c) => c.name);
  assert.equal(names.includes('spec-components'), false);
  assert.deepEqual(names, LINT_CHECKS_ON_MAIN.filter((c) => c.name !== 'spec-components').map((c) => c.name));
});

test('advisory is omitted rather than false, as callers have always seen it', () => {
  const { checks } = lintSpec(cleanSpec());
  const blocking = checks.find((c) => c.name === 'has-title');
  assert.equal('advisory' in blocking, false);
  assert.equal(checks.find((c) => c.name === 'spec-language').advisory, true);
});

test('every check carries a non-empty detail', () => {
  for (const c of lintSpec(cleanSpec()).checks) {
    assert.ok(c.detail && c.detail.length, `${c.name} has no detail`);
  }
});

test('a failing blocking rule makes the verdict false; a failing advisory one does not', () => {
  assert.equal(lintSpec(specWith('has-title')).ok, false);
  const wordy = cleanSpec({
    sections: [{ id: 'tldr', title: 'TL;DR', body: '<p>This is probably the fastest option — worth noting.</p>' }],
  });
  const res = lintSpec(wordy);
  assert.equal(res.checks.find((c) => c.name === 'spec-language').ok, false);
  assert.equal(res.ok, true, 'an advisory failure must not fail the lint');
});

test('a rule that does not apply is omitted from the report entirely', () => {
  // spec-components reports only on specs that opted into the library, which the
  // corpus fixture has not. It is present here because the fixture is stamped by
  // neither path; the assertion is that `applies:false` removes a rule rather
  // than reporting it as a pass.
  const verdicts = runCheckRules(
    [defineRule({ id: 'inapplicable', check: () => ({ applies: false }) })],
    cleanSpec(),
  );
  assert.deepEqual(verdicts, []);
});

test('defineRule refuses a rule answered two ways, or no way', () => {
  assert.throws(() => defineRule({ id: 'both', check: () => ({ ok: true }), ask: 'a sentence' }), /one way/);
  assert.throws(() => defineRule({ id: 'neither' }), /neither check nor ask/);
  assert.throws(() => defineRule({ ask: 'no id' }), /id is required/);
  assert.throws(() => defineRule({ id: 'bad-sev', ask: 'x', severity: 'loud' }), /unknown severity/);
});

test('an id that could not be named in --judged is refused at authoring time', () => {
  // A rule id has to round-trip through `verify --judged a,b,c`. One carrying a
  // comma could never be named there, so the gate would fail on it forever with
  // no way to settle it. Greptile on #179.
  assert.throws(() => defineRule({ id: 'a,b', ask: 'x' }), /cannot contain a comma or whitespace/);
  assert.throws(() => defineRule({ id: 'a b', ask: 'x' }), /cannot contain a comma or whitespace/);
  assert.throws(() => defineRule({ id: 'a\tb', ask: 'x' }), /cannot contain a comma or whitespace/);
  // The ids people actually write are fine.
  assert.equal(defineRule({ id: 'no-build-plan', ask: 'x' }).id, 'no-build-plan');
  assert.equal(defineRule({ id: 'rule_2.v1', ask: 'x' }).id, 'rule_2.v1');
});

test('a template cannot smuggle in an unnameable id either', () => {
  assert.throws(
    () => mergeRules([], [{ id: 'has,comma', ask: 'Something must hold.' }]),
    /cannot contain a comma or whitespace/,
  );
});

test('a rule defaults to blocking, scope all, and its id as its title', () => {
  const r = defineRule({ id: 'x', ask: 'Something must be true.' });
  assert.equal(r.severity, 'blocking');
  assert.equal(r.scope, 'all');
  assert.equal(r.title, 'x');
  assert.equal(r.check, null);
  assert.equal(isCheckRule(r), false);
});

test('a rule that throws is reported as failing, not propagated', () => {
  const verdicts = runCheckRules(
    [defineRule({ id: 'explodes', check: () => { throw new Error('boom'); } })],
    cleanSpec(),
  );
  assert.equal(verdicts[0].ok, false);
  assert.match(verdicts[0].detail, /rule threw: boom/);
});

test('a rule that throws a non-Error is still reported, not propagated', () => {
  // `throw null` is legal and reading .message off it throws again, inside the
  // catch, where nothing is left to handle it. Greptile P2 on #168.
  for (const thrown of [null, undefined, 'a string', 42]) {
    const verdicts = runCheckRules(
      [defineRule({ id: 'odd-throw', check: () => { throw thrown; } })],
      cleanSpec(),
    );
    assert.equal(verdicts[0].ok, false);
    assert.match(verdicts[0].detail, /^rule threw: /);
  }
});

test('one broken rule does not stop the rules after it', () => {
  const verdicts = runCheckRules(
    [
      defineRule({ id: 'explodes', check: () => { throw new Error('boom'); } }),
      defineRule({ id: 'fine', check: () => ({ ok: true, detail: 'ok' }) }),
    ],
    cleanSpec(),
  );
  assert.deepEqual(verdicts.map((v) => v.id), ['explodes', 'fine']);
});

test('a template override changes severity and keeps everything else', () => {
  const base = [defineRule({ id: 'no-aphorisms', ask: 'No line works as a standalone tweet.', fix: 'Cut it.' })];
  const merged = mergeRules(base, [{ id: 'no-aphorisms', severity: 'advisory' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, 'advisory');
  assert.equal(merged[0].ask, 'No line works as a standalone tweet.');
  assert.equal(merged[0].fix, 'Cut it.');
});

test('severity off removes the rule from the type entirely', () => {
  const base = [
    defineRule({ id: 'no-aphorisms', ask: 'No aphorisms.' }),
    defineRule({ id: 'has-title', check: () => ({ ok: true, detail: 'present' }) }),
  ];
  const merged = mergeRules(base, [{ id: 'no-aphorisms', severity: 'off' }]);
  assert.deepEqual(merged.map((r) => r.id), ['has-title']);
});

test('a template rule with a new id is added', () => {
  const base = [defineRule({ id: 'has-title', check: () => ({ ok: true, detail: 'x' }) })];
  const merged = mergeRules(base, [{ id: 'no-build-plan', ask: 'There is no stage list.' }]);
  assert.deepEqual(merged.map((r) => r.id), ['has-title', 'no-build-plan']);
  assert.equal(merged[1].severity, 'blocking', 'a template rule defaults to blocking');
});

test('an override with a misspelled severity is refused, not silently applied', () => {
  // An override matching an existing id never goes through defineRule, so
  // without a check here "advisroy" would set a severity nothing recognises:
  // not off, not blocking, and quietly uncounted. Greptile P2 on #168.
  const base = [defineRule({ id: 'no-aphorisms', ask: 'No aphorisms.' })];
  assert.throws(() => mergeRules(base, [{ id: 'no-aphorisms', severity: 'advisroy' }]), /unknown severity/);
  assert.throws(() => mergeRules(base, [{ id: 'no-aphorisms', severity: '' }]), /unknown severity/);
  // undefined still means "inherit", which is what a bare override relies on.
  assert.equal(mergeRules(base, [{ id: 'no-aphorisms', ask: 'Restated.' }])[0].severity, 'blocking');
});

test('a template rule with a new id but no sentence is refused', () => {
  assert.throws(
    () => mergeRules([], [{ id: 'invented', severity: 'blocking' }]),
    /neither check nor ask/,
  );
});

test('restating a check-rule in prose replaces the function with the sentence', () => {
  const base = [defineRule({ id: 'has-title', check: () => ({ ok: true, detail: 'x' }) })];
  const merged = mergeRules(base, [{ id: 'has-title', ask: 'The title names the decision, not the area.' }]);
  assert.equal(merged[0].check, null, 'running the old function while reporting the new sentence would lie');
  assert.equal(merged[0].ask, 'The title names the decision, not the area.');
});

test('overrides keep base order and append only what is new', () => {
  const base = ['a', 'b', 'c'].map((id) => defineRule({ id, ask: `${id} must hold.` }));
  const merged = mergeRules(base, [{ id: 'c', severity: 'advisory' }, { id: 'd', ask: 'd must hold.' }]);
  assert.deepEqual(merged.map((r) => r.id), ['a', 'b', 'c', 'd']);
});

test('a duplicate id inside one list is reported rather than silently winning', () => {
  const rules = [
    defineRule({ id: 'same', ask: 'First.' }),
    defineRule({ id: 'same', ask: 'Second.' }),
    defineRule({ id: 'other', ask: 'Third.' }),
  ];
  assert.deepEqual(duplicateRuleIds(rules), ['same']);
  assert.deepEqual(duplicateRuleIds([defineRule({ id: 'only', ask: 'x' })]), []);
});

test('the structural rules carry no duplicate ids', () => {
  assert.deepEqual(duplicateRuleIds(STRUCTURAL_RULES), []);
});

test('forType keeps scope all and the named type, and drops the rest', () => {
  const rules = [
    defineRule({ id: 'everywhere', ask: 'x', scope: 'all' }),
    defineRule({ id: 'research-only', ask: 'y', scope: 'research' }),
    defineRule({ id: 'deck-only', ask: 'z', scope: 'deck' }),
  ];
  assert.deepEqual(forType(rules, 'research').map((r) => r.id), ['everywhere', 'research-only']);
  assert.deepEqual(forType(rules, 'design').map((r) => r.id), ['everywhere']);
});

test('every structural rule is a check-rule with a fix hint', () => {
  for (const r of STRUCTURAL_RULES) {
    assert.equal(isCheckRule(r), true, `${r.id} should be answered by Node`);
    assert.ok(r.fix.length, `${r.id} has no fix hint`);
    assert.ok(r.title.length, `${r.id} has no title`);
  }
});

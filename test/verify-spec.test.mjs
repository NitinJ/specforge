// The verifier: what `ok` means, and the third state that makes it mean anything.
//
// A spec that passes every mechanical check but has judged rules nobody has
// judged is NOT verified. Reporting those as passes would manufacture assurance,
// which is the one failure mode that makes this system worse than having none
// (D5). So the tests below care most about `pending`.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { verifySpec, formatReport } from '../lib/verify-spec.mjs';
import { ensureTemplates, templateHtmlFor, templateId } from '../lib/store-templates.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { cleanSpec, specWith } from './helpers/spec-corpus.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-verify-');

// The rules block's own </ul>, not the first list in the document — a shell has
// content lists long before it gets to the rules, and targeting `<ul>` puts the
// edit in the Goals section where nothing reads it. Appended at the END of the
// block so an override lands after the rule it overrides; merge is last-wins.
const RULES_UL_END = '\n  </ul>\n</section>';

/** Append rule <li>s to the end of a seeded template's rules block. */
function addToTemplateRules(type, lis) {
  ensureTemplates();
  const html = templateHtmlFor(type);
  assert.ok(html.includes(RULES_UL_END), 'the rules block anchor moved; this helper needs updating');
  writeFileSync(specHtmlPath(templateId(type)), html.replace(RULES_UL_END, `\n${lis}${RULES_UL_END}`));
}

test('a clean spec still is not ok, because nothing judged has been judged', () => {
  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.failed.length, 0, 'no mechanical rule failed');
  assert.equal(r.ok, false, 'and yet: blocking judgements are outstanding');
  assert.ok(r.pending.length > 0);
});

test('pending holds every rule a function cannot answer, and nothing else', () => {
  const r = verifySpec(cleanSpec(), 'design');
  for (const p of r.pending) {
    assert.ok(p.ask && p.ask.length, `${p.id} is pending without a sentence to judge`);
    assert.ok(p.fix, `${p.id} is pending without a fix hint`);
  }
  const answered = new Set(r.verdicts.map((v) => v.id));
  for (const p of r.pending) assert.equal(answered.has(p.id), false, `${p.id} is both answered and pending`);
});

test('the nine blocking judgements are what a normal creation costs', () => {
  const r = verifySpec(cleanSpec(), 'design');
  const blocking = r.pending.filter((p) => p.severity === 'blocking');
  // Nine global, plus design's own no-build-plan.
  assert.equal(blocking.length, 10);
});

test('a mechanical failure shows up in failed and in verdicts', () => {
  const r = verifySpec(specWith('no-placeholders'), 'design');
  assert.equal(r.ok, false);
  assert.ok(r.failed.some((v) => v.id === 'no-placeholders'));
  assert.ok(r.verdicts.find((v) => v.id === 'no-placeholders').detail.includes('1 left'));
});

test('an advisory failure does not appear in failed', () => {
  const wordy = cleanSpec({
    sections: [{ id: 'tldr', title: 'TL;DR', body: '<p>This is probably the fastest option — worth noting.</p>' }],
  });
  const r = verifySpec(wordy, 'design');
  assert.ok(r.verdicts.some((v) => v.id === 'spec-language' && !v.ok));
  assert.equal(r.failed.some((v) => v.id === 'spec-language'), false);
});

test('turning off a rule that does not exist is a no-op, not a crash', () => {
  // A template carrying an `off` for an id that has since been renamed is stale.
  // Being strict about it would stop every spec of that type verifying at all.
  addToTemplateRules('design', '<li data-sf-rule="a-rule-that-never-existed" data-sf-severity="off"></li>');
  const r = verifySpec(cleanSpec(), 'design');
  assert.ok(r.pending.length > 0, 'the rest of the list still loads');
  assert.equal(r.pending.some((p) => p.id === 'a-rule-that-never-existed'), false);
});

test('a spec with no blocking rules left to judge is ok', () => {
  // Turn every blocking ask-rule off through the template, which is the same
  // mechanism a real type uses, and the verdict flips. This is the ONLY way a
  // real spec reaches ok: nothing is stored (D2), so the verifier never learns
  // that the agent judged a pending rule, and re-running reports the same list.
  // The loop ends in the agent's judgement and a handover, not in a green run.
  const r0 = verifySpec(cleanSpec(), 'design');
  addToTemplateRules('design', r0.pending
    .filter((p) => p.severity === 'blocking')
    .map((p) => `<li data-sf-rule="${p.id}" data-sf-severity="off"></li>`)
    .join('\n'));

  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.pending.filter((p) => p.severity === 'blocking').length, 0);
  assert.equal(r.ok, true);
  assert.equal(r.exit, 0);
});

test('re-running an untouched spec reports the same pending list', () => {
  // Stated as a test because the skill says "fix and re-run", and a reader could
  // reasonably expect re-running to shrink the list. It does not, and the report
  // says so in as many words.
  const a = verifySpec(cleanSpec(), 'design');
  const b = verifySpec(cleanSpec(), 'design');
  assert.deepEqual(a.pending.map((p) => p.id), b.pending.map((p) => p.id));
});

test('the type decides the rule list', () => {
  const design = verifySpec(cleanSpec(), 'design');
  const research = verifySpec(cleanSpec(), 'research');
  assert.ok(research.pending.some((p) => p.id === 'findings-cite-sources'));
  assert.equal(design.pending.some((p) => p.id === 'findings-cite-sources'), false);
  assert.equal(design.type, 'design');
});

test('a deck does not carry no-aphorisms, which is the override that justifies the mechanism', () => {
  const deck = verifySpec(cleanSpec(), 'deck');
  assert.equal(deck.pending.some((p) => p.id === 'no-aphorisms'), false);
  assert.ok(verifySpec(cleanSpec(), 'design').pending.some((p) => p.id === 'no-aphorisms'));
});

test('a rule that abstains is neither answered nor pending', () => {
  // spec-components reports nothing on a spec that never opted into the library.
  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.verdicts.some((v) => v.id === 'spec-components'), false);
  assert.equal(r.pending.some((p) => p.id === 'spec-components'), false);
});

test('a template that lists a rule twice is told so', () => {
  // Checked on the template's raw list. The merge is last-wins by id, so asking
  // the merged list asks one the duplicate has already been erased from: it can
  // never report one. An earlier version of this test asserted `duplicates` was
  // empty and explained it away, which documented a broken feature rather than
  // failing. Greptile on #173.
  addToTemplateRules('design', '<li data-sf-rule="twice">First.</li>\n<li data-sf-rule="twice">Second.</li>');
  const r = verifySpec(cleanSpec(), 'design');
  assert.deepEqual(r.duplicates, ['twice'], 'the authoring error is reported');
  assert.equal(r.pending.filter((p) => p.id === 'twice').length, 1, 'and the later one is what runs');
  assert.equal(r.pending.find((p) => p.id === 'twice').ask, 'Second.');
});

test('a template with no duplicates reports none', () => {
  assert.deepEqual(verifySpec(cleanSpec(), 'design').duplicates, []);
  assert.deepEqual(verifySpec(cleanSpec(), 'design-impl').duplicates, []);
});

test('the exit field separates a failure from work outstanding', () => {
  // One non-zero code cannot tell a broken spec from an unjudged one, and they
  // call for different things.
  assert.equal(verifySpec(specWith('no-placeholders'), 'design').exit, 1);
  assert.equal(verifySpec(cleanSpec(), 'design').exit, 2);
});

// ── The report ──────────────────────────────────────────────────────────────

test('the report leads with what needs action, not with the ticks', () => {
  const text = formatReport(verifySpec(specWith('no-placeholders'), 'design'));
  assert.ok(text.indexOf('FAILED') < text.indexOf('PENDING'), 'failures come first');
  assert.ok(text.indexOf('PENDING') < text.indexOf('PASSED'), 'then the work list, then the passes');
});

test('the report names the rule and how to fix it', () => {
  const text = formatReport(verifySpec(specWith('no-placeholders'), 'design'));
  assert.match(text, /no-placeholders/);
  assert.match(text, /fix: Replace each one/);
});

test('the report never says PASS while a blocking judgement is outstanding', () => {
  const text = formatReport(verifySpec(cleanSpec(), 'design'));
  assert.match(text, /verify: WORK OUTSTANDING/);
  assert.doesNotMatch(text, /verify: PASS/);
  assert.match(text, /blocking judgement\(s\) are yours to make/);
});

test('the report says plainly that re-running will not clear the pending list', () => {
  // The skill says "fix and re-run", and a reader could reasonably expect the
  // list to shrink. Nothing is stored, so it does not.
  const text = formatReport(verifySpec(cleanSpec(), 'design'));
  assert.match(text, /Re-running does not clear these/);
});

test('the report distinguishes a failure from work outstanding', () => {
  assert.match(formatReport(verifySpec(specWith('no-placeholders'), 'design')), /verify: FAILED/);
  assert.match(formatReport(verifySpec(cleanSpec(), 'design')), /verify: WORK OUTSTANDING/);
});

test('the report says PASS when there is genuinely nothing left', () => {
  const result = { ok: true, exit: 0, type: 'design', verdicts: [{ id: 'has-title', ok: true, severity: 'blocking', detail: 'present', fix: '' }], pending: [], failed: [], duplicates: [] };
  const text = formatReport(result);
  assert.match(text, /verify: PASS \(design\)/);
  assert.doesNotMatch(text, /PENDING/);
});

test('a duplicated template rule is called out at the top of the report', () => {
  const result = { ok: false, exit: 2, type: 'design', verdicts: [], pending: [], failed: [], duplicates: ['twice'] };
  const text = formatReport(result);
  assert.match(text, /template lists twice twice/);
  assert.match(text, /Delete one/);
});

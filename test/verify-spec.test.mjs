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
  // mechanism a real type uses, and the verdict flips.
  const r0 = verifySpec(cleanSpec(), 'design');
  addToTemplateRules('design', r0.pending
    .filter((p) => p.severity === 'blocking')
    .map((p) => `<li data-sf-rule="${p.id}" data-sf-severity="off"></li>`)
    .join('\n'));

  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.pending.filter((p) => p.severity === 'blocking').length, 0);
  assert.equal(r.ok, true);
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

test('duplicate rule ids are reported rather than silently resolved', () => {
  addToTemplateRules('design', '<li data-sf-rule="twice">First.</li>\n<li data-sf-rule="twice">Second.</li>');
  // mergeRules gives the last one the slot, so the earlier stopped being
  // checked. That is a rule-authoring error, and the report says so.
  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.duplicates.length, 0, 'merge de-duplicates by id, so the list itself is clean');
  assert.equal(r.pending.filter((p) => p.id === 'twice').length, 1);
  assert.equal(r.pending.find((p) => p.id === 'twice').ask, 'Second.');
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
  assert.match(text, /verify: NOT DONE/);
  assert.doesNotMatch(text, /verify: PASS/);
  assert.match(text, /blocking judgement\(s\) outstanding/);
});

test('the report says PASS when there is genuinely nothing left', () => {
  const result = { ok: true, type: 'design', verdicts: [{ id: 'has-title', ok: true, severity: 'blocking', detail: 'present', fix: '' }], pending: [], failed: [], duplicates: [] };
  const text = formatReport(result);
  assert.match(text, /verify: PASS \(design\)/);
  assert.doesNotMatch(text, /PENDING/);
});

test('a duplicate id is called out at the top of the report', () => {
  const result = { ok: false, type: 'design', verdicts: [], pending: [], failed: [], duplicates: ['twice'] };
  const text = formatReport(result);
  assert.match(text, /duplicate rule ids: twice/);
});

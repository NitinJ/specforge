// The gate: PASS or FAIL, and the loop that gets you from one to the other.
//
// The property that makes it a gate rather than a report is that FAIL is
// reachable, actionable and escapable: it names what is wrong, fixing those
// things makes it PASS, and nothing else does.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { verifySpec, formatReport, EXIT } from '../lib/verify-spec.mjs';
import { ensureTemplates, templateHtmlFor, templateId } from '../lib/store-templates.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { cleanSpec, specWith } from './helpers/spec-corpus.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-verify-');

// The rules block's own </ul>, not the first list in the document — a shell has
// content lists long before it gets to the rules. Appended at the END so an
// override lands after the rule it overrides; merge is last-wins.
const RULES_UL_END = '\n  </ul>\n</section>';

function addToTemplateRules(type, lis) {
  ensureTemplates();
  const html = templateHtmlFor(type);
  assert.ok(html.includes(RULES_UL_END), 'the rules block anchor moved; this helper needs updating');
  writeFileSync(specHtmlPath(templateId(type)), html.replace(RULES_UL_END, `\n${lis}${RULES_UL_END}`));
}

/** Every rule the gate is waiting on, which is what the agent works through. */
const failingIds = (r) => r.failing.map((f) => f.id);

test('a spec nobody has judged fails the gate', () => {
  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(r.pass, false);
  assert.equal(r.exit, EXIT.FAIL);
  assert.ok(r.failing.length > 0);
});

test('judging every rule it asks about makes it pass', () => {
  // This is the loop. Nothing else needs to happen: the spec is mechanically
  // clean, so the judgements are all that stand between it and PASS.
  const first = verifySpec(cleanSpec(), 'design');
  const second = verifySpec(cleanSpec(), 'design', { judged: failingIds(first) });
  assert.equal(second.pass, true);
  assert.equal(second.exit, EXIT.PASS);
  assert.deepEqual(second.failing, []);
});

test('judging some but not all still fails, and names only what is left', () => {
  const first = verifySpec(cleanSpec(), 'design');
  const some = failingIds(first).slice(0, 2);
  const second = verifySpec(cleanSpec(), 'design', { judged: some });
  assert.equal(second.pass, false);
  for (const id of some) assert.equal(failingIds(second).includes(id), false, `${id} should be settled`);
  assert.equal(second.failing.length, first.failing.length - some.length);
});

test('judging does not paper over a rule a function actually failed', () => {
  // The whole point of the mechanical half: claiming to have judged a broken
  // spec must not make it pass.
  const html = specWith('no-placeholders');
  const r = verifySpec(html, 'design', { judged: ['no-placeholders'] });
  assert.equal(r.pass, false);
  assert.ok(failingIds(r).includes('no-placeholders'));
  assert.equal(r.failing.find((f) => f.id === 'no-placeholders').kind, 'check');
});

test('fixing what the report named makes that entry go away', () => {
  const before = verifySpec(specWith('no-placeholders'), 'design');
  assert.ok(failingIds(before).includes('no-placeholders'));
  const after = verifySpec(cleanSpec(), 'design');
  assert.equal(failingIds(after).includes('no-placeholders'), false);
});

test('each failing entry says which kind of work it needs', () => {
  const r = verifySpec(specWith('no-placeholders'), 'design');
  for (const f of r.failing) {
    assert.ok(['check', 'judge'].includes(f.kind), `${f.id} has no kind`);
    assert.ok(f.why && f.why.length, `${f.id} does not say what is wrong`);
    assert.ok(f.fix && f.fix.length, `${f.id} does not say what to do`);
  }
});

test('an advisory rule never holds up the gate', () => {
  const wordy = cleanSpec({
    sections: [{ id: 'tldr', title: 'TL;DR', body: '<p>This is probably the fastest option — worth noting.</p>' }],
  });
  const r = verifySpec(wordy, 'design', { judged: failingIds(verifySpec(wordy, 'design')) });
  assert.ok(r.advisories.some((a) => a.id === 'spec-language'), 'still reported');
  assert.equal(r.pass, true, 'but does not block');
});

test('a judged id nothing recognises fails the gate rather than being ignored', () => {
  // Otherwise a typo in --judged silently leaves a rule unjudged while the agent
  // believes it settled one.
  const first = verifySpec(cleanSpec(), 'design');
  const r = verifySpec(cleanSpec(), 'design', { judged: [...failingIds(first), 'no-such-rule'] });
  assert.deepEqual(r.unknownJudged, ['no-such-rule']);
  assert.equal(r.pass, false);
});

test('a repeated judged id is settled once, not counted twice', () => {
  const first = verifySpec(cleanSpec(), 'design');
  const ids = failingIds(first);
  const r = verifySpec(cleanSpec(), 'design', { judged: [...ids, ...ids] });
  assert.equal(r.pass, true);
  assert.equal(r.judged.length, ids.length);
});

test('the type decides what has to be judged', () => {
  const design = verifySpec(cleanSpec(), 'design');
  const research = verifySpec(cleanSpec(), 'research');
  assert.ok(failingIds(research).includes('findings-cite-sources'));
  assert.equal(failingIds(design).includes('findings-cite-sources'), false);
});

test('a deck is not asked about no-aphorisms at all, which is the override that matters', () => {
  // Advisory globally, so on a design spec it is reported without blocking. The
  // deck template turns it off, so it is not reported either.
  const design = verifySpec(cleanSpec(), 'design');
  assert.ok(design.advisories.some((a) => a.id === 'no-aphorisms'));
  assert.equal(failingIds(design).includes('no-aphorisms'), false, 'advisory never blocks');

  const deck = verifySpec(cleanSpec(), 'deck');
  assert.equal(deck.advisories.some((a) => a.id === 'no-aphorisms'), false);
  assert.equal(failingIds(deck).includes('no-aphorisms'), false);
});

test('a rule that abstains is neither failing nor passed', () => {
  // spec-components reports nothing on a spec that never opted into the library.
  const r = verifySpec(cleanSpec(), 'design');
  assert.equal(failingIds(r).includes('spec-components'), false);
  assert.equal(r.passed.includes('spec-components'), false);
});

test('a template that lists a rule twice is told so', () => {
  addToTemplateRules('design', '<li data-sf-rule="twice">First.</li>\n<li data-sf-rule="twice">Second.</li>');
  const r = verifySpec(cleanSpec(), 'design');
  assert.deepEqual(r.duplicates, ['twice']);
  assert.equal(failingIds(r).filter((id) => id === 'twice').length, 1, 'and only the later one runs');
});

test('turning a rule off in the template stops the gate asking about it', () => {
  addToTemplateRules('design', '<li data-sf-rule="unknowns-are-written-down" data-sf-severity="off"></li>');
  assert.equal(failingIds(verifySpec(cleanSpec(), 'design')).includes('unknowns-are-written-down'), false);
});

// ── The report ──────────────────────────────────────────────────────────────

test('the report separates what to fix from what to judge', () => {
  const text = formatReport(verifySpec(specWith('no-placeholders'), 'design'));
  assert.match(text, /^FIX — /m);
  assert.match(text, /^JUDGE — /m);
  assert.ok(text.indexOf('FIX') < text.indexOf('JUDGE'), 'mechanical work first, it is cheaper');
  assert.ok(text.indexOf('JUDGE') < text.indexOf('PASSED'), 'the passes come last');
});

test('the report hands the agent the exact flag to run next', () => {
  const text = formatReport(verifySpec(cleanSpec(), 'design'));
  assert.match(text, /--judged [a-z-]+,[a-z-]+/);
});

test('the report says FAIL and how much of each kind of work is left', () => {
  const text = formatReport(verifySpec(specWith('no-placeholders'), 'design'));
  assert.match(text, /verify: FAIL \(design\) — \d+ to fix, \d+ to judge/);
});

test('the report says PASS once the loop closes', () => {
  const first = verifySpec(cleanSpec(), 'design');
  const text = formatReport(verifySpec(cleanSpec(), 'design', { judged: failingIds(first) }));
  assert.match(text, /verify: PASS \(design\)/);
  assert.doesNotMatch(text, /^FIX — /m);
  assert.doesNotMatch(text, /^JUDGE — /m);
});

test('a mistyped judged id is called out at the top of the report', () => {
  const text = formatReport(verifySpec(cleanSpec(), 'design', { judged: ['nope'] }));
  assert.match(text, /--judged names nope, which is not a rule for this type/);
});

test('a duplicated template rule is called out at the top of the report', () => {
  addToTemplateRules('design', '<li data-sf-rule="twice">First.</li>\n<li data-sf-rule="twice">Second.</li>');
  assert.match(formatReport(verifySpec(cleanSpec(), 'design')), /template lists twice twice/);
});

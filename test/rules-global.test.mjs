// The global rule list, and the matrix Stage 0's fixtures were built for.
//
// The matrix is the point: each defect fixture must fail its own rule AND pass
// every other one. A rule that fires on a defect it does not own is a rule that
// will fire on real specs for reasons its detail string cannot explain, and the
// author learns to ignore the report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ALL_GLOBAL_RULES, GLOBAL_RULES, SCAFFOLDING_RULE_COUNT } from '../lib/rules/global.mjs';
import { duplicateRuleIds, isCheckRule } from '../lib/rules/index.mjs';
import { runCheckRules } from '../lib/rules/run.mjs';
import { cleanSpec, specWith, DEFECT_IDS } from './helpers/spec-corpus.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The verdict for one rule id against one document, or null when it abstained. */
function verdictFor(html, id) {
  const rule = ALL_GLOBAL_RULES.find((r) => r.id === id);
  assert.ok(rule, `no such rule: ${id}`);
  return runCheckRules([rule], html)[0] || null;
}

test('the global list is 32 rules, 14 answered by code and 18 by the agent', () => {
  assert.equal(ALL_GLOBAL_RULES.length, 32);
  const fn = ALL_GLOBAL_RULES.filter(isCheckRule);
  assert.equal(fn.length, 14);
  assert.equal(ALL_GLOBAL_RULES.length - fn.length, 18);
});

test('nine blocking rules are answered by the agent, which is the cost per creation', () => {
  const blockingAsk = ALL_GLOBAL_RULES.filter((r) => !isCheckRule(r) && r.severity === 'blocking');
  assert.equal(blockingAsk.length, 9);
});

test('no rule id appears twice', () => {
  assert.deepEqual(duplicateRuleIds(ALL_GLOBAL_RULES), []);
});

test('no global rule is scoped to a type; those live in templates', () => {
  const scoped = ALL_GLOBAL_RULES.filter((r) => r.scope !== 'all').map((r) => r.id);
  assert.deepEqual(scoped, [], 'a type-scoped rule belongs in its template block (D12)');
});

test('every rule carries a sentence or a function, a title and a fix hint', () => {
  for (const r of ALL_GLOBAL_RULES) {
    assert.ok(isCheckRule(r) || (r.ask && r.ask.length > 20), `${r.id}: ask is missing or too thin`);
    assert.ok(r.title && r.title.length, `${r.id}: no title`);
    assert.ok(r.fix && r.fix.length, `${r.id}: no fix hint`);
    assert.equal(r.ask === null || r.check === null, true, `${r.id}: answered two ways`);
  }
});

test('the merged rules from D11 exist and the rules they absorbed do not', () => {
  const ids = ALL_GLOBAL_RULES.map((r) => r.id);
  assert.ok(ids.includes('no-repeated-claims'));
  assert.ok(ids.includes('prescriptions-name-their-source'));
  assert.equal(ids.includes('decisions-match-prose'), false, 'absorbed by no-repeated-claims');
  assert.equal(ids.includes('numbers-have-provenance'), false, 'absorbed by prescriptions-name-their-source');
});

test('the absorbed rules kept their blocking severity through the merge', () => {
  // numbers-have-provenance was blocking and prescriptions-name-their-source was
  // advisory. Merging the harder rule into the softer one would have quietly
  // stopped numbers being enforced, which is not what a merge should cost.
  const merged = ALL_GLOBAL_RULES.find((r) => r.id === 'prescriptions-name-their-source');
  assert.equal(merged.severity, 'blocking');
  assert.equal(ALL_GLOBAL_RULES.find((r) => r.id === 'no-repeated-claims').severity, 'blocking');
});

test('scaffolding rules come first, so the report reads in fix order', () => {
  assert.deepEqual(
    GLOBAL_RULES.slice(0, SCAFFOLDING_RULE_COUNT).map((r) => r.id),
    ['no-placeholders', 'no-empty-sections', 'toc-in-sync', 'front-matter-filled'],
  );
  assert.deepEqual(
    ALL_GLOBAL_RULES.slice(0, SCAFFOLDING_RULE_COUNT + 1).map((r) => r.id),
    ['no-placeholders', 'no-empty-sections', 'toc-in-sync', 'front-matter-filled', 'has-title'],
  );
});

test('the clean spec passes every rule a function can answer', () => {
  const failed = runCheckRules(ALL_GLOBAL_RULES, cleanSpec()).filter((v) => !v.ok);
  assert.deepEqual(failed.map((v) => `${v.id}: ${v.detail}`), []);
});

// ── The matrix ──────────────────────────────────────────────────────────────
// Each defect fails its own rule and passes every other. Stage 0 built the
// fixtures for this and could not run it, because the rules did not exist yet.

// Some rules genuinely overlap: a spec with no title fails `has-title` and also
// fails `front-matter-filled`, because a title is one of the four fields it
// checks. That is correct, not collateral. So each defect declares exactly which
// other rules it is expected to trip, and the assertion is equality — a co-fire
// nobody declared fails the test, and so does a declared one that stops
// happening. The list below is documentation of where the rules touch.
const DEFECT_RULE = {
  'no-placeholders': { rule: 'no-placeholders', alsoFires: ['front-matter-filled'] },
  'no-empty-sections': { rule: 'no-empty-sections', alsoFires: [] },
  'toc-in-sync': { rule: 'toc-in-sync', alsoFires: ['internal-links-resolve'] },
  'front-matter-filled': { rule: 'front-matter-filled', alsoFires: ['no-placeholders'] },
  'internal-links-resolve': { rule: 'internal-links-resolve', alsoFires: [] },
  'references-are-links': { rule: 'references-are-links', alsoFires: [] },
  'has-title': { rule: 'has-title', alsoFires: ['front-matter-filled'] },
  'has-status': { rule: 'has-status', alsoFires: ['front-matter-filled'] },
  // Renaming a section orphans both its TOC entry and the link to it.
  'unique-section-ids': { rule: 'unique-section-ids', alsoFires: ['toc-in-sync', 'internal-links-resolve'] },
  'theme-contract': { rule: 'theme-contract', alsoFires: [] },
  'palette-tokens': { rule: 'palette-tokens', alsoFires: [] },
};

test('every defect in the corpus has a rule that owns it', () => {
  assert.deepEqual(Object.keys(DEFECT_RULE).sort(), [...DEFECT_IDS].sort());
});

for (const [defect, { rule: ruleId, alsoFires }] of Object.entries(DEFECT_RULE)) {
  test(`${defect}: the rule that owns it fails`, () => {
    const v = verdictFor(specWith(defect), ruleId);
    assert.ok(v, `${ruleId} abstained on its own defect`);
    assert.equal(v.ok, false, `${ruleId} passed a spec built to fail it`);
    assert.ok(v.detail.length, `${ruleId} failed without saying why`);
  });

  test(`${defect}: fires exactly the rules it should and no others`, () => {
    const fired = runCheckRules(ALL_GLOBAL_RULES, specWith(defect))
      .filter((v) => !v.ok && v.id !== ruleId)
      .map((v) => v.id)
      .sort();
    assert.deepEqual(fired, [...alsoFires].sort());
  });
}

// ── Grounding: the rules run against the real shells ────────────────────────
// A rule invented against a fixture and never run on a real document is a rule
// that fails every real document. The bundled shells are the closest thing to
// one that lives in the repo.

const SHELLS = readdirSync(join(REPO, 'templates'))
  .filter((f) => f.startsWith('spec-base') && f.endsWith('.html'));

test('there are shells to check', () => {
  assert.ok(SHELLS.length >= 5, `expected the bundled shells, found ${SHELLS.length}`);
});

for (const shell of SHELLS) {
  test(`${shell}: passes every blocking rule a template can pass`, () => {
    const html = readFileSync(join(REPO, 'templates', shell), 'utf8');
    // A shell is placeholders by definition, so these two are expected to fail
    // on it and only on it. Everything else blocking must pass, or the rule is
    // wrong. Advisory hits are left alone: a shell's guidance prose is written
    // for the author, not held to the language contract it is teaching.
    const exempt = new Set(['no-placeholders', 'front-matter-filled']);
    const failed = runCheckRules(ALL_GLOBAL_RULES, html)
      .filter((v) => !v.ok && v.severity === 'blocking' && !exempt.has(v.id))
      .map((v) => `${v.id}: ${v.detail}`);
    assert.deepEqual(failed, []);
  });

  test(`${shell}: is a template, so it fails the two rules that say so`, () => {
    const html = readFileSync(join(REPO, 'templates', shell), 'utf8');
    assert.equal(verdictFor(html, 'no-placeholders').ok, false);
    assert.equal(verdictFor(html, 'front-matter-filled').ok, false);
  });
}

// ── Individual rule behaviour ───────────────────────────────────────────────

test('toc-in-sync abstains on a spec with no table of contents', () => {
  assert.equal(verdictFor(cleanSpec({ toc: false }), 'toc-in-sync'), null);
});

test('toc-in-sync catches an unlisted section as well as a stale link', () => {
  const unlisted = cleanSpec().replace(
    '</body>',
    '<section id="late"><h2>Late</h2><p>Added after the TOC was written.</p></section></body>',
  );
  const v = verdictFor(unlisted, 'toc-in-sync');
  assert.equal(v.ok, false);
  assert.match(v.detail, /sections not linked: late/);
});

test('no-empty-sections counts a diagram or a table as content', () => {
  for (const body of ['<svg viewBox="0 0 1 1"></svg>', '<table><tr><td>a</td></tr></table>']) {
    const html = cleanSpec({
      sections: [{ id: 'tldr', title: 'TL;DR', body }],
    });
    assert.equal(verdictFor(html, 'no-empty-sections').ok, true, `${body} should count as content`);
  }
});

test('no-empty-sections names the sections it found empty', () => {
  const v = verdictFor(specWith('no-empty-sections'), 'no-empty-sections');
  assert.match(v.detail, /hollow/);
});

test('no-placeholders reports how many are left and shows some', () => {
  const v = verdictFor(specWith('no-placeholders'), 'no-placeholders');
  assert.match(v.detail, /1 left/);
  assert.match(v.detail, /\{\{TITLE\}\}/);
});

test('no-placeholders is not confused by a previous call', () => {
  // A /g regex carries lastIndex between calls. Running the rule twice on the
  // same document must give the same answer both times.
  const html = specWith('no-placeholders');
  assert.equal(verdictFor(html, 'no-placeholders').ok, false);
  assert.equal(verdictFor(html, 'no-placeholders').ok, false);
});

test('front-matter-filled is not confused by a previous call either', () => {
  const html = specWith('front-matter-filled');
  assert.equal(verdictFor(html, 'front-matter-filled').ok, false);
  assert.equal(verdictFor(html, 'front-matter-filled').ok, false);
  assert.equal(verdictFor(cleanSpec(), 'front-matter-filled').ok, true);
});

test('front-matter-filled names which field is unfilled', () => {
  assert.match(verdictFor(specWith('front-matter-filled'), 'front-matter-filled').detail, /owner/);
  assert.match(verdictFor(cleanSpec({ date: '' }), 'front-matter-filled').detail, /date/);
  assert.match(verdictFor(cleanSpec({ status: '{{STATUS}}' }), 'front-matter-filled').detail, /status/);
});

test('internal-links-resolve reads ids from anywhere, not just sections', () => {
  const html = cleanSpec().replace(
    '</section>\n</body>',
    '<p id="footnote-1">A note.</p><p>See <a href="#footnote-1">the note</a>.</p></section>\n</body>',
  );
  assert.equal(verdictFor(html, 'internal-links-resolve').ok, true);
});

test('references-are-links ignores a path inside code, a pre block or a link', () => {
  const cases = [
    '<p>The parser lives in <code>lib/spec.mjs</code>.</p>',
    '<pre>lib/spec.mjs</pre>',
    '<p>The parser lives in <a href="/x">lib/spec.mjs</a>.</p>',
  ];
  for (const body of cases) {
    const html = cleanSpec({ sections: [{ id: 'tldr', title: 'TL;DR', body }] });
    assert.equal(verdictFor(html, 'references-are-links').ok, true, `should be exempt: ${body}`);
  }
});

test('references-are-links ignores a diagram label and a code-block caption', () => {
  // Found by running the rules against a real spec: an architecture diagram
  // labels its nodes with filenames, and a code block captions itself with one.
  // Neither can be a link, so flagging them is advice that cannot be taken.
  const cases = [
    '<p>Text.</p><figure><svg viewBox="0 0 10 10"><text>lib/rules/global.mjs</text></svg></figure>',
    '<div class="codeblock"><span class="filename">lib/rules/global.mjs</span><pre>x</pre></div>',
  ];
  for (const body of cases) {
    const html = cleanSpec({ sections: [{ id: 'tldr', title: 'TL;DR', body }] });
    assert.equal(verdictFor(html, 'references-are-links').ok, true, `should be exempt: ${body.slice(0, 40)}`);
  }
});

test('no-placeholders ignores a placeholder inside a code sample', () => {
  // A spec that documents the shell's own syntax writes {{ … }} in <code>.
  // Failing it for that would mean the rule cannot be described in a spec.
  for (const body of ['<p>No <code>{{ … }}</code> remains.</p>', '<pre>{{TITLE}}</pre>']) {
    const html = cleanSpec({ sections: [{ id: 'tldr', title: 'TL;DR', body }] });
    assert.equal(verdictFor(html, 'no-placeholders').ok, true, `should be exempt: ${body}`);
  }
  // and still catches one in prose, which is the case it exists for
  const real = cleanSpec({ sections: [{ id: 'tldr', title: 'TL;DR', body: '<p>{{ Write the summary. }}</p>' }] });
  assert.equal(verdictFor(real, 'no-placeholders').ok, false);
});

test('references-are-links catches a bare section reference', () => {
  const html = cleanSpec({
    sections: [{ id: 'tldr', title: 'TL;DR', body: '<p>The rules are listed in §5 and tuned in §6.1.</p>' }],
  });
  const v = verdictFor(html, 'references-are-links');
  assert.equal(v.ok, false);
  assert.match(v.detail, /§5/);
});

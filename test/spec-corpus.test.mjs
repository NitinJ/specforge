// The corpus fixtures are themselves tested, because every rule test that
// follows trusts two claims about them: the clean spec is actually clean, and a
// defect builder changes exactly the one thing it names. A fixture that quietly
// stops being minimal turns a rule test green for the wrong reason.
//
// The full matrix — each defect fails its own rule and passes the others — needs
// the rule registry, so it lands with the rules in test/rules-global.test.mjs.
// What is asserted here is the fixture contract that matrix depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSpec } from '../lib/lint-spec.mjs';
import { cleanSpec, specWith, DEFECTS, DEFECT_IDS } from './helpers/spec-corpus.mjs';

test('the clean spec passes every check the lint has today', () => {
  const { ok, checks } = lintSpec(cleanSpec());
  const failed = checks.filter((c) => !c.ok && !c.advisory).map((c) => c.name);
  assert.deepEqual(failed, [], 'clean spec must fail nothing');
  assert.equal(ok, true);
});

test('every defect builder changes the document', () => {
  for (const id of DEFECT_IDS) {
    assert.notEqual(specWith(id), cleanSpec(), `${id} left the spec untouched`);
  }
});

test('the defects the current lint can see do fail it', () => {
  // Only the five rules that exist today can be asserted end to end here. The
  // rest are covered once their rules land in Stage 2.
  const covered = {
    'has-title': 'has-title',
    'has-status': 'has-status',
    'unique-section-ids': 'unique-section-ids',
    'theme-contract': 'theme-contract',
    'palette-tokens': 'palette-tokens',
  };
  for (const [defect, ruleName] of Object.entries(covered)) {
    const { checks } = lintSpec(specWith(defect));
    const check = checks.find((c) => c.name === ruleName);
    assert.equal(check.ok, false, `${defect} should fail ${ruleName}`);
  }
});

test('a defect the current lint cannot see leaves it green', () => {
  // This is the whole reason the verifier exists: a spec with a placeholder in
  // its title passes the lint today. If this ever goes red, the lint grew a
  // check and the rule list should be reconciled with it.
  assert.equal(lintSpec(specWith('no-placeholders')).ok, true);
  assert.equal(lintSpec(specWith('front-matter-filled')).ok, true);
});

test('an unknown defect name is refused rather than silently ignored', () => {
  assert.throws(() => specWith('no-such-defect'), /unknown defect/);
});

test('every defect is exported for table-driven tests', () => {
  assert.deepEqual(DEFECT_IDS, Object.keys(DEFECTS));
  assert.ok(DEFECT_IDS.length >= 11, 'the corpus should cover every mechanical rule');
});

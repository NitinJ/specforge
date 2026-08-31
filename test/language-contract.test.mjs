// The contract in force: what an agent writing spec prose is actually handed.
//
// The claim under test is the one the Language tab makes. If the box holds the
// writing rules and the box is editable, then deleting a rule has to delete it
// for the agent too. It did not, at first: the authoring skills read the shipped
// file directly, and an absence is not a disagreement, so nothing was there for
// the user's version to win against.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempStore } from './helpers/temp-store.mjs';
import { seedPrompts } from './helpers/prompts-store.mjs';
import { shippedLanguageContract, languageContract, languageIsDefault }
  from '../lib/language-contract.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-lang-');

test('an untouched store is handed the shipped rules', () => {
  assert.equal(languageContract(), shippedLanguageContract());
  assert.equal(languageIsDefault(), true);
});

test('an edited contract is handed over instead of the shipped one', () => {
  seedPrompts({ language: '# Ours\n\nWrite terse.', languageMode: 'contract' });
  assert.equal(languageContract(), '# Ours\n\nWrite terse.');
  assert.equal(languageIsDefault(), false);
});

test('a deleted rule is actually gone, which is the whole point', () => {
  // The defect this closes: the box said the rule was removed and the agent
  // still read it out of the shipped file.
  const shipped = shippedLanguageContract();
  assert.match(shipped, /em dash/i, 'the fixture rule is in the shipped contract');
  seedPrompts({
    language: shipped.replace(/^.*em dash.*$/gim, ''),
    languageMode: 'contract',
  });
  assert.equal(/em dash/i.test(languageContract()), false);
});

test('a direction from before the box held the contract is added to the rules', () => {
  // Such a store's owner wrote a note on top of the shipped rules. Handing that
  // note over alone would tell the agent it is the complete writing contract.
  seedPrompts({ language: 'Write terse.' });
  const out = languageContract();
  assert.match(out, /Spec language contract/, 'the shipped rules survive');
  assert.match(out, /Write terse\./);
  assert.ok(out.indexOf('Write terse.') > out.indexOf('## Register'),
    'and the direction comes last, where the more specific instruction wins');
});

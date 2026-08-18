// What an authoring agent is told about the interactive collection.
//
// references/spec-components.md is the file the create-spec skill reads before
// writing anything, and it is the only place an agent learns a component exists.
// A component that is in the registry but not findable here is a component
// nobody uses.
//
// The bar for these three is higher than for a static one. An agent has to learn
// not just what they assert but what they cost: a reader with no script sees
// every panel, a collapsed block is not in the outline, and a sorted order is
// not the order that exports.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRules } from '../lib/components-rules.mjs';
import { componentsIn } from '../components/index.mjs';

const md = buildRules();

test('every interactive component has an entry', () => {
  for (const c of componentsIn('interactive')) {
    assert.ok(md.includes(c.rule), `${c.name}'s rule is in the file`);
  }
});

test('an agent can find them by what the block asserts, not by class name', () => {
  // The selection table is what an author scans mid-sentence. Reaching the
  // component requires the question, not the answer.
  const selection = md.slice(md.indexOf('## Choosing'), md.indexOf('## Drawing'));
  assert.match(selection, /second pass/i, 'hiding detail leads to the disclosure');
  assert.match(selection, /disclosure/, 'and names it');
  assert.match(selection, /alternative forms|one of several/i, 'alternatives lead to tabs');
  assert.match(selection, /\.tabs/, 'and names it');
  assert.match(selection, /ordered|order/i, 'a long table leads to sortable');
  assert.match(selection, /table\.sortable/, 'and names it');
});

test('the file says what an interactive component costs', () => {
  const section = md.slice(md.indexOf('## Interactive'));
  assert.ok(section.length, 'there is a section about them');
  assert.match(section, /no javascript|without javascript|script/i,
    'it says behaviour is not guaranteed');
  assert.match(section, /file:\/\//, 'and names the case that makes it matter');
});

test('it warns about the failure mode that has no symptom', () => {
  // Content behind a label nobody clicks is the way tabs go wrong, and the
  // author is the only one who can prevent it.
  const section = md.slice(md.indexOf('## Interactive'));
  assert.match(section, /outline|contents rail/i, 'a disclosure is not in the outline');
});

test('each interactive entry is marked as one where it is defined', () => {
  // Scanning the family sections, an author must be able to tell that
  // `<details class="disclosure">` behaves differently from `.panel` beside it.
  // Anchored on the `### ` heading, not on the first mention: every one of these
  // also appears in the selection table above, and the first version of this
  // test matched there and reported a heading that was in fact marked.
  const headingFor = (c) => {
    const sel = c.selector ? `\`${c.selector}\`` : `\`.${c.name}\``;
    const at = md.indexOf(`### ${sel}`);
    assert.ok(at > 0, `${c.name} has a heading`);
    return md.slice(at, md.indexOf('\n', at));
  };
  for (const c of componentsIn('interactive')) {
    assert.match(headingFor(c), /interactive/i, `${c.name}'s heading says so`);
  }
});

test('a static component is not marked interactive', () => {
  const at = md.indexOf('### `.panel`');
  assert.ok(at > 0, 'panel has a heading');
  const line = md.slice(at, md.indexOf('\n', at));
  assert.ok(!/interactive/i.test(line), 'the marker means something');
});

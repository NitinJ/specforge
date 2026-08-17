// The eleven actions, checked against the shortlist that chose them.
//
// The counts and the kinds are not decoration: they were settled in review over
// a corpus of 318 comments, and a list that drifts from the spec is a list
// nobody can argue with. Asserted against a literal here so a change to either
// has to be a change to both.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §6, §8.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ACTIONS, actionById, forScope } from '../lib/actions/all.mjs';
import { duplicateActionIds } from '../lib/actions/index.mjs';

// id, kind, scope — the three things the menu and the agent both key off.
// Menu order: local before global, by kind inside a scope, by how often it was
// asked inside a kind.
const EXPECTED = [
  ['explain_simply', 'aside', 'local'],
  ['visualize', 'aside', 'local'],
  ['go_deeper', 'aside', 'local'],
  ['verify_against_code', 'aside', 'local'],
  ['help_me_decide', 'aside', 'local'],
  ['show_an_example', 'aside', 'local'],
  ['restructure', 'in-place', 'local'],
  ['tighten', 'in-place', 'local'],
  ['copy_link', 'direct', 'local'],
  ['fix_the_naming', 'in-place', 'global'],
  ['consistency_pass', 'in-place', 'global'],
  ['canonicalize', 'in-place', 'global'],
  // Not in any menu: these render as buttons on an aside. They split on whether
  // answering needs judgement — Import goes to the agent, Delete is `direct`
  // because rejecting a draft has nothing in it for an agent to decide.
  ['import', 'in-place', 'aside'],
  ['delete', 'direct', 'aside'],
];

test('the registry is exactly the shortlist, in menu order', () => {
  assert.equal(
    ALL_ACTIONS.map((a) => `${a.id} ${a.kind} ${a.scope}`).join('\n'),
    EXPECTED.map((e) => e.join(' ')).join('\n'),
  );
});

test('every id is unique', () => {
  assert.deepEqual(duplicateActionIds(ALL_ACTIONS), []);
});

test('every agentic action carries a standing instruction', () => {
  // The criterion the shortlist was selected on: an action earns a menu entry
  // when a good standing instruction can be written for it. A one-line
  // instruction is a sign nobody wrote one.
  for (const a of ALL_ACTIONS.filter((x) => x.kind !== 'direct')) {
    assert.ok(a.instruction.length > 40, `${a.id} has a token instruction`);
  }
});

test('two actions declare that they need a detail from the reader', () => {
  // D7: these two were left out until an action became a comment, because a
  // click had nowhere to put the one fact only the reader has. Flagged so the
  // agent asks rather than guesses when the comment arrives with nothing added.
  assert.deepEqual(
    ALL_ACTIONS.filter((a) => a.needsDetail).map((a) => a.id),
    ['verify_against_code', 'fix_the_naming'],
  );
});

test('forScope splits local from global, and direct actions ride with local', () => {
  assert.equal(
    forScope('local').map((a) => a.id).join(' '),
    'explain_simply visualize go_deeper verify_against_code help_me_decide show_an_example '
      + 'restructure tighten copy_link',
  );
  assert.equal(
    forScope('global').map((a) => a.id).join(' '),
    'fix_the_naming consistency_pass canonicalize',
  );
  assert.equal(
    forScope('aside').map((a) => a.id).join(' '),
    'import delete',
    'the aside scope never reaches a menu; the context menu filters to local',
  );
});

test('Delete is answered by the browser and never reaches an agent', () => {
  // A `direct` action carries no instruction because nobody reads one. Making
  // it `in-place` again would put a comment in the queue for a delete, which is
  // the round trip this stage removed.
  const del = actionById('delete');
  assert.equal(del.kind, 'direct');
  assert.equal(del.instruction, '');
  assert.equal(del.importInstruction, '', 'nothing about it is imported');
});

test('the only actions the browser answers are Copy link and Delete', () => {
  // Every other action is a comment. Two exceptions, both because there is no
  // judgement in them: one reads an anchor, one removes a draft nobody accepted.
  assert.deepEqual(
    ALL_ACTIONS.filter((a) => a.kind === 'direct').map((a) => a.id),
    ['copy_link', 'delete'],
  );
});

test('actionById finds an action and returns null for an unknown id', () => {
  assert.equal(actionById('tighten').label, 'Tighten');
  assert.equal(actionById('tightenn'), null);
  assert.equal(actionById(''), null);
  assert.equal(actionById(undefined), null);
});

test('no two actions share a label or an icon', () => {
  // Two entries reading the same in the menu is the failure a user sees; two
  // sharing an icon is the one they misread.
  const labels = ALL_ACTIONS.map((a) => a.label);
  const icons = ALL_ACTIONS.map((a) => a.icon);
  assert.equal(new Set(labels).size, labels.length, 'labels are distinct');
  assert.equal(new Set(icons).size, icons.length, 'icons are distinct');
});

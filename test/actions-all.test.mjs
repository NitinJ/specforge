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
import { duplicateActionIds, GROUPS } from '../lib/actions/index.mjs';

// id, kind, scope, group — what the menu and the agent key off. Declaration
// order is menu order, and the menu groups by what the reader is trying to get:
// understand it, check it, change it, then the whole spec.
const EXPECTED = [
  ['explain_simply', 'aside', 'local', 'understand'],
  ['visualize', 'aside', 'local', 'understand'],
  ['go_deeper', 'aside', 'local', 'understand'],
  ['show_an_example', 'aside', 'local', 'understand'],
  ['verify_against_code', 'aside', 'local', 'check'],
  ['help_me_decide', 'aside', 'local', 'check'],
  ['restructure', 'in-place', 'local', 'change'],
  ['tighten', 'in-place', 'local', 'change'],
  ['delete_block', 'direct', 'local', 'change'],
  ['copy_link', 'direct', 'local', 'null'],
  ['fix_the_naming', 'in-place', 'global', 'whole'],
  ['consistency_pass', 'in-place', 'global', 'whole'],
  ['canonicalize', 'in-place', 'global', 'whole'],
  // Not in any menu: these render as buttons on an aside, so they have no group.
  // They split on whether answering needs judgement — Import goes to the agent,
  // Delete is `direct` because rejecting a draft has nothing to decide.
  ['import', 'in-place', 'aside', 'null'],
  ['delete', 'direct', 'aside', 'null'],
];

test('the registry is exactly the shortlist, with its groups', () => {
  assert.equal(
    ALL_ACTIONS.map((a) => `${a.id} ${a.kind} ${a.scope} ${a.group}`).join('\n'),
    EXPECTED.map((e) => e.join(' ')).join('\n'),
  );
});

test('declaration order is menu order', () => {
  // The renderer sorts by group, so a registry that declared them interleaved
  // would read nothing like the menu it produces. Reading this file top to
  // bottom has to be reading the menu.
  const seen = [];
  for (const a of ALL_ACTIONS) {
    if (!a.group || seen[seen.length - 1] === a.group) continue;
    assert.equal(seen.includes(a.group), false, `${a.group} is declared in two runs`);
    seen.push(a.group);
  }
  assert.deepEqual(seen, GROUPS.map((g) => g.id));
});

test('Delete is the last thing in its group', () => {
  // The only entry that removes the reader's own writing. Mid-list it is the one
  // you hit reaching for the item below it.
  const change = ALL_ACTIONS.filter((a) => a.group === 'change').map((a) => a.id);
  assert.equal(change[change.length - 1], 'delete_block');
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
    'explain_simply visualize go_deeper show_an_example verify_against_code help_me_decide '
      + 'restructure tighten delete_block copy_link',
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

test('the browser answers only the three actions with nothing to decide', () => {
  // Everything else is a comment. These three are not, because none of them
  // needs judgement: one reads an anchor that already exists, and two remove
  // something the reader has looked at and rejected.
  assert.deepEqual(
    ALL_ACTIONS.filter((a) => a.kind === 'direct').map((a) => a.id),
    ['delete_block', 'copy_link', 'delete'],
  );
});

test('actionById finds an action and returns null for an unknown id', () => {
  assert.equal(actionById('tighten').label, 'Tighten');
  assert.equal(actionById('tightenn'), null);
  assert.equal(actionById(''), null);
  assert.equal(actionById(undefined), null);
});

test('no two actions on the same surface share a label or an icon', () => {
  // Two entries reading the same is only a failure where a reader sees them
  // together, and the scopes never appear together: a menu shows local or
  // global, a draft shows its own two buttons. Delete is deliberately the word
  // in two of them, because deleting a paragraph and deleting a draft are the
  // same verb and calling one of them something else to satisfy a check here
  // would make the product worse.
  for (const scope of ['local', 'global', 'aside']) {
    const here = ALL_ACTIONS.filter((a) => a.scope === scope);
    const labels = here.map((a) => a.label);
    const icons = here.map((a) => a.icon);
    assert.equal(new Set(labels).size, labels.length, `labels are distinct within ${scope}`);
    assert.equal(new Set(icons).size, icons.length, `icons are distinct within ${scope}`);
  }
});

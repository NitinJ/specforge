// What an action is, and what the registry refuses.
//
// An action id is not a label. It is a token that travels inside a comment body
// as `@agent @visualize`, so the parser that reads it back has to be able to find
// where the token ends. Everything defineAction refuses is a case where that
// round trip breaks, discovered at load time rather than as a menu entry that
// silently does nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAction, KINDS, SCOPES } from '../lib/actions/index.mjs';

const ok = {
  id: 'visualize',
  label: 'Visualize',
  icon: '⊐',
  kind: 'aside',
  scope: 'local',
  instruction: 'Choose the form the content wants and build it.',
  importInstruction: 'Replace the blocks the diagram carries forward, and nothing else.',
};

test('a well-formed action keeps every field it was given', () => {
  const a = defineAction(ok);
  assert.equal(a.id, 'visualize');
  assert.equal(a.label, 'Visualize');
  assert.equal(a.kind, 'aside');
  assert.equal(a.scope, 'local');
  assert.equal(a.instruction, ok.instruction);
  assert.equal(a.importInstruction, ok.importInstruction);
});

test('an id has to be a lowercase token with underscores', () => {
  // Each of these breaks the same thing: `@agent @<id>` has to be readable back
  // out of a comment body, and the parser stops the token at whitespace.
  for (const bad of ['help me decide', 'help-me-decide', 'HelpMeDecide', 'help,decide', '']) {
    assert.throws(
      () => defineAction({ ...ok, id: bad }),
      /id/,
      `expected ${JSON.stringify(bad)} to be refused`,
    );
  }
  assert.equal(defineAction({ ...ok, id: 'help_me_decide' }).id, 'help_me_decide');
});

test('kind and scope come from a fixed list', () => {
  assert.throws(() => defineAction({ ...ok, kind: 'inplace' }), /kind/);
  assert.throws(() => defineAction({ ...ok, scope: 'section' }), /scope/);
  // Import guidance goes with the aside kind, so it comes off for the others.
  for (const kind of KINDS) {
    assert.ok(defineAction({ ...ok, kind, importInstruction: kind === 'aside' ? ok.importInstruction : undefined }));
  }
  for (const scope of SCOPES) assert.ok(defineAction({ ...ok, scope }));
});

test('an agentic action without an instruction is refused', () => {
  // The instruction is the whole point: what the menu entry carries is a written
  // standard, not the word on the button. One missing means a comment that says
  // @agent @visualize and nothing the agent can act on.
  assert.throws(() => defineAction({ ...ok, instruction: '' }), /instruction/);
  assert.throws(() => defineAction({ ...ok, instruction: '   ' }), /instruction/);
});

test('a direct action needs no instruction, because no agent reads it', () => {
  const copy = defineAction({
    id: 'copy_link', label: 'Copy link', icon: '🔗', kind: 'direct', scope: 'local',
  });
  assert.equal(copy.instruction, '');
  assert.equal(copy.kind, 'direct');
});

test('an aside action without import guidance is refused', () => {
  // The second instruction, and required for the same reason as the first: what
  // to write and what to do with it once written are two different standards. A
  // diagram supersedes the prose it was drawn from, a plain-language rewrite
  // sits beside it, and a verification report is not spec prose at all. Leaving
  // it unsaid is what left the agent placing content with nothing to go on.
  assert.throws(() => defineAction({ ...ok, importInstruction: undefined }), /importInstruction/);
  assert.throws(() => defineAction({ ...ok, importInstruction: '   ' }), /importInstruction/);
});

test('only an aside carries import guidance, because only an aside is imported', () => {
  // On anything else it is a statement about a thing that never happens, and
  // reads as though it does.
  assert.throws(
    () => defineAction({ ...ok, kind: 'in-place', importInstruction: 'Replace it.' }),
    /importInstruction/,
  );
  const inPlace = defineAction({ ...ok, kind: 'in-place', importInstruction: undefined });
  assert.equal(inPlace.importInstruction, '');
});

test('a label and an icon are required', () => {
  assert.throws(() => defineAction({ ...ok, label: '' }), /label/);
  assert.throws(() => defineAction({ ...ok, icon: '' }), /icon/);
});

// What `@import` merges, and where.
//
// The instruction said "merge this aside into the section above it". Two things
// wrong with that. It names a position where the aside records an identity, so
// an aside sitting after another aside merges into the wrong place. And it works
// on the section when the request was about a block: ask for a diagram of one
// paragraph in a twelve-paragraph section and the result lands wherever the
// agent felt like putting it.
//
// The aside already knows both: `data-sf-aside` names the section it came from
// and `data-sf-block` names the block. This resolves the target from those.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTarget } from '../lib/actions/import-target.mjs';

const SPEC = `<!doctype html><html><body><main>
  <section id="object"><h2>1 · Object</h2><p id="p1">First.</p><p id="p2">Second.</p></section>
  <section id="object-aside-1" data-sf-aside="object" data-sf-block="b4" data-sf-action="visualize">
    <h3>Aside: Visualize</h3><p>A diagram.</p></section>
  <section id="object-aside-2" data-sf-aside="object" data-sf-action="explain_simply">
    <h3>Aside: Explain simply</h3><p>In plain words.</p></section>
</main></body></html>`;

test('the target is read from the aside, not from what sits above it', () => {
  // object-aside-2 has object-aside-1 above it. "The section above" would merge
  // one draft into another.
  const t = importTarget(SPEC, 'object-aside-2');
  assert.equal(t.section, 'object');
  assert.equal(t.aside, 'object-aside-2');
});

test('it carries the block the action was asked about', () => {
  assert.equal(importTarget(SPEC, 'object-aside-1').block, 'b4');
});

test('an aside with no block falls back to the section', () => {
  const t = importTarget(SPEC, 'object-aside-2');
  assert.equal(t.block, null);
});

test('the mode comes from the action that produced the aside', () => {
  // Visualize supersedes the prose it was drawn from, so importing it replaces
  // the section. Everything else adds to what is there.
  assert.equal(importTarget(SPEC, 'object-aside-1').mode, 'replace');
  assert.equal(importTarget(SPEC, 'object-aside-2').mode, 'merge');
});

test('an unknown aside resolves to nothing rather than guessing', () => {
  assert.equal(importTarget(SPEC, 'object-aside-9'), null);
  assert.equal(importTarget(SPEC, 'object'), null, 'a section is not an aside');
});

test('an aside naming an action the registry lost still resolves its target', () => {
  // The mode is unknown, so it takes the safe one: add rather than replace.
  const renamed = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="visualise"');
  const t = importTarget(renamed, 'object-aside-1');
  assert.equal(t.section, 'object');
  assert.equal(t.mode, 'merge', 'never destructive on a guess');
});

test('the instruction it produces names the target, not a direction', () => {
  const replace = importTarget(SPEC, 'object-aside-1');
  assert.match(replace.next, /object/);
  assert.match(replace.next, /[Rr]eplace/);
  assert.equal(/above it/.test(replace.next), false);

  const merge = importTarget(SPEC, 'object-aside-2');
  assert.match(merge.next, /object/);
  assert.equal(/[Rr]eplace the section/.test(merge.next), false);
});

test('a merge with a block says to place the content beside that block', () => {
  const withBlock = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="go_deeper"');
  const t = importTarget(withBlock, 'object-aside-1');
  assert.equal(t.mode, 'merge');
  assert.match(t.next, /b4/, 'the block it was asked about');
});

// An aside outlives edits to the document around it. Renaming a section id or
// deleting the section leaves the aside naming something that is not there, and
// the resolver's whole job is turning that name into an instruction the agent
// acts on. A `replace` aimed at a missing section is the destructive case.

test('a source section that is gone produces no instruction to act on it', () => {
  const gone = SPEC.replace('<section id="object">', '<section id="the-object">');
  const t = importTarget(gone, 'object-aside-1');
  assert.equal(t.mode, 'unresolved');
  assert.equal(/[Rr]eplace the section/.test(t.next), false, 'nothing destructive on a name that resolves to nothing');
  assert.equal(/[Mm]erge this aside/.test(t.next), false);
});

test('and it says to ask rather than to find something close', () => {
  const gone = SPEC.replace('<section id="object">', '<section id="the-object">');
  const t = importTarget(gone, 'object-aside-1');
  assert.match(t.next, /object/, 'the name it was looking for');
  assert.match(t.next, /ask/i);
  assert.equal(t.section, 'object', 'still reported, so the reply can name it');
});

test('a block the registry no longer has is dropped from the instruction', () => {
  // The bid lives in blocks.json, not in the spec, so the caller passes what is
  // live. Telling the agent to place content after a block that is not there is
  // an instruction it cannot follow.
  const merge = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="go_deeper"');
  const t = importTarget(merge, 'object-aside-1', { bids: new Set(['b1', 'b2']) });
  assert.equal(t.block, null);
  assert.equal(/b4/.test(t.next), false);
  assert.match(t.next, /where it belongs/);
});

test('a block still in the registry is kept', () => {
  const merge = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="go_deeper"');
  const t = importTarget(merge, 'object-aside-1', { bids: new Set(['b4']) });
  assert.equal(t.block, 'b4');
  assert.match(t.next, /b4/);
});

test('no registry in hand keeps the block rather than dropping it', () => {
  // The registry is derived and disposable: a missing one means "unknown", not
  // "deleted". Dropping the block there would lose a good anchor on every call
  // made without one.
  assert.equal(importTarget(SPEC, 'object-aside-1').block, 'b4');
});

test('a resolved target takes one of the two modes the registry can declare', () => {
  // `unresolved` is the resolver's own, for a target that is not there. An
  // action cannot declare it, so no new action can invent a third verb.
  for (const id of ['object-aside-1', 'object-aside-2']) {
    assert.ok(['merge', 'replace'].includes(importTarget(SPEC, id).mode));
  }
});

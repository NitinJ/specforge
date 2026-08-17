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
import { ALL_ACTIONS } from '../lib/actions/all.mjs';

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

test('the guidance comes from the action that produced the aside', () => {
  // Not a merge/replace flag. What folding a draft in means depends on what kind
  // of draft it is, and only the action that wrote it knows: a diagram
  // supersedes the prose it was drawn from, a plain-language rewrite sits beside
  // it and cuts nothing.
  const diagram = importTarget(SPEC, 'object-aside-1');
  const plain = importTarget(SPEC, 'object-aside-2');
  assert.match(diagram.guidance, /supersedes/);
  assert.match(plain.guidance, /never in place of it/);
  assert.notEqual(diagram.guidance, plain.guidance);
});

test('the guidance reaches the sentence the agent reads', () => {
  // Carried on the thread rather than left for a lookup, which is the whole
  // lesson of stage 8: an instruction the agent has to decide to fetch is an
  // instruction it does not read.
  const t = importTarget(SPEC, 'object-aside-1');
  assert.ok(t.next.includes(t.guidance), 'the guidance is in the sentence, not only beside it');
  assert.match(t.next, /came from Visualize/, 'and it says which kind of draft this is');
});

test('the opening does not presume the draft is prose that goes in', () => {
  // Two of the six are not content to paste. A verification report imports as
  // corrections to the claims it found wrong; a decision aid imports as the
  // decision, not the option list. An opening that says "fold this content into
  // the section" contradicts their own guidance two sentences later.
  const report = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="verify_against_code"');
  const t = importTarget(report, 'object-aside-1');
  assert.equal(/[Ff]old this aside's content into/.test(t.next), false);
  assert.match(t.next, /Import this aside into the section/);
});

test('the agent is told to cut only what the draft carries forward', () => {
  // The one rule that holds over every kind of import. A diagram covering three
  // paragraphs of twelve replaces three, not twelve.
  for (const id of ['object-aside-1', 'object-aside-2']) {
    assert.match(importTarget(SPEC, id).next, /[Cc]ut only what the draft carries forward/);
  }
});

test('an unknown aside resolves to nothing rather than guessing', () => {
  assert.equal(importTarget(SPEC, 'object-aside-9'), null);
  assert.equal(importTarget(SPEC, 'object'), null, 'a section is not an aside');
});

test('an aside naming an action the registry lost still resolves its target', () => {
  // No guidance to give, so the import is told to cut nothing and to say so.
  const renamed = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="visualise"');
  const t = importTarget(renamed, 'object-aside-1');
  assert.equal(t.section, 'object');
  assert.equal(t.guidance, '');
  assert.match(t.next, /without cutting anything/, 'never destructive on a guess');
});

test('the instruction it produces names the target, not a direction', () => {
  const t = importTarget(SPEC, 'object-aside-1');
  assert.match(t.next, /object/);
  assert.equal(/above it/.test(t.next), false);
});

test('an import with a block says to place the content around that block', () => {
  const withBlock = SPEC.replace('data-sf-action="visualize"', 'data-sf-action="go_deeper"');
  const t = importTarget(withBlock, 'object-aside-1');
  assert.match(t.next, /b4/, 'the block it was asked about');
});

// An aside outlives edits to the document around it. Renaming a section id or
// deleting the section leaves the aside naming something that is not there, and
// the resolver's whole job is turning that name into an instruction the agent
// acts on. A `replace` aimed at a missing section is the destructive case.

test('a source section that is gone produces no instruction to act on it', () => {
  const gone = SPEC.replace('<section id="object">', '<section id="the-object">');
  const t = importTarget(gone, 'object-aside-1');
  assert.equal(t.resolved, false);
  assert.equal(/[Ff]old this aside/.test(t.next), false, 'nothing aimed at a name that resolves to nothing');
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

test('every aside action in the registry has guidance to give', () => {
  // A missing one is only visible at import time, which is the worst moment to
  // find out: the reader has accepted a draft and the agent has nothing to go on.
  for (const a of ALL_ACTIONS.filter((x) => x.kind === 'aside')) {
    assert.ok(a.importInstruction.length > 40, `${a.id} has no usable import guidance`);
  }
});

test('no two aside actions import the same way', () => {
  // If two were identical the guidance would not be earning its place, and the
  // merge/replace flag it replaced would have been enough.
  const seen = ALL_ACTIONS.filter((a) => a.kind === 'aside').map((a) => a.importInstruction);
  assert.equal(new Set(seen).size, seen.length);
});

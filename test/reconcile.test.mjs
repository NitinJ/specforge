// Unit tests for the block reconcile (server/public/reconcile.js) — the pure
// function that decides which block on the page is which block from last time.
// No DOM: it takes two arrays and returns a mapping, which is the whole reason
// it is structured this way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'server', 'public', 'reconcile.js'), 'utf8');
const sandbox = {};
new Function('window', SRC)(sandbox);
const { reconcile, hashBlock, SCHEMA } = sandbox.SFReconcile;

// Terse fixture helpers: p('a') is a paragraph reading "a".
const p = (text) => ({ tag: 'P', text });
const h2 = (text) => ({ tag: 'H2', text });
const build = (page, registry) => reconcile(page, registry);
/** Reconcile once from nothing, to get a registry to edit against. */
const seed = (page) => build(page, null).registry;

test('a first-time spec gives every block an id', () => {
  const page = [h2('Data model'), p('one'), p('two')];
  const r = build(page, null);
  assert.equal(r.bids.length, 3);
  assert.equal(new Set(r.bids).size, 3, 'ids are distinct');
  assert.deepEqual(r.gone, []);
  assert.ok(r.changed, 'a brand new registry is a change');
  assert.equal(r.registry.schema, SCHEMA);
});

test('an untouched spec keeps every id and reports no change', () => {
  const page = [h2('Data model'), p('one'), p('two')];
  const first = build(page, null);
  const again = build(page, first.registry);
  assert.deepEqual(again.bids, first.bids, 'same ids');
  assert.equal(again.changed, false, 'nothing to write');
  assert.equal(again.registry.version, first.registry.version, 'version does not churn');
});

test('reconciling is idempotent — running it twice more changes nothing', () => {
  const page = [h2('A'), p('x'), p('y')];
  let reg = seed(page);
  for (let i = 0; i < 3; i++) {
    const r = build(page, reg);
    assert.equal(r.changed, false);
    reg = r.registry;
  }
  assert.deepEqual(reg.blocks.map((b) => b.bid), ['b1', 'b2', 'b3']);
});

test('an edited block keeps its id — this is the whole point', () => {
  const before = [h2('Data model'), p('Garment = Style'), h2('Testing')];
  const reg = seed(before);
  const after = [h2('Data model'), p('A Garment is Style x Colorway'), h2('Testing')];
  const r = build(after, reg);
  assert.equal(r.bids[1], reg.blocks[1].bid, 'the reworded paragraph is still the same paragraph');
  assert.deepEqual(r.gone, [], 'nothing was deleted');
});

test('a block rewritten beyond recognition still keeps its id', () => {
  const before = [h2('A'), p('the quick brown fox jumps over the lazy dog'), h2('B')];
  const reg = seed(before);
  const after = [h2('A'), p('completely unrelated prose about turbines'), h2('B')];
  const r = build(after, reg);
  assert.equal(r.bids[1], reg.blocks[1].bid,
    'identity comes from the unchanged neighbours, not from similarity');
});

test('an inserted block gets a fresh id and leaves its neighbours alone', () => {
  const before = [h2('A'), p('one'), h2('B')];
  const reg = seed(before);
  const after = [h2('A'), p('one'), p('inserted'), h2('B')];
  const r = build(after, reg);
  assert.equal(r.bids[0], reg.blocks[0].bid);
  assert.equal(r.bids[1], reg.blocks[1].bid);
  assert.equal(r.bids[3], reg.blocks[2].bid, 'the heading after it is untouched');
  assert.ok(!reg.blocks.some((b) => b.bid === r.bids[2]), 'the new block has a genuinely new id');
  assert.deepEqual(r.gone, []);
});

test('a deleted block is reported gone, by id', () => {
  const before = [h2('A'), p('keep'), p('delete me'), h2('B')];
  const reg = seed(before);
  const goneBid = reg.blocks[2].bid;
  const r = build([h2('A'), p('keep'), h2('B')], reg);
  assert.deepEqual(r.gone, [goneBid], 'deletion is a fact, not a failed search');
  assert.equal(r.bids[1], reg.blocks[1].bid, 'its neighbour is unaffected');
});

test('a whole section deleted reports every one of its ids', () => {
  const before = [h2('Keep'), p('a'), h2('Doomed'), p('b'), p('c'), h2('Also keep')];
  const reg = seed(before);
  const doomed = [reg.blocks[2].bid, reg.blocks[3].bid, reg.blocks[4].bid];
  const r = build([h2('Keep'), p('a'), h2('Also keep')], reg);
  assert.deepEqual(r.gone.sort(), doomed.sort());
});

test('a delete and an insert in the same gap pair up in order', () => {
  const before = [h2('A'), p('old one'), p('old two'), h2('B')];
  const reg = seed(before);
  // "old one" is edited, "old two" is deleted.
  const r = build([h2('A'), p('edited one'), h2('B')], reg);
  assert.equal(r.bids[1], reg.blocks[1].bid, 'the surviving paragraph inherits the FIRST leftover id');
  assert.deepEqual(r.gone, [reg.blocks[2].bid], 'the second is the one reported gone');
});

test('a changed block never inherits an id from a different tag', () => {
  const before = [h2('A'), h2('a heading that will go'), h2('B')];
  const reg = seed(before);
  // The heading is replaced by a paragraph: different tag, so no inheritance.
  const r = build([h2('A'), p('now a paragraph'), h2('B')], reg);
  assert.notEqual(r.bids[1], reg.blocks[1].bid, 'a paragraph must not become the old heading');
  assert.deepEqual(r.gone, [reg.blocks[1].bid], 'the heading is gone');
});

test('duplicate text keeps distinct ids — the case that silently mis-anchors today', () => {
  const page = [p('N/A'), h2('Middle'), p('N/A')];
  const reg = seed(page);
  assert.notEqual(reg.blocks[0].bid, reg.blocks[2].bid, 'two identical paragraphs are two blocks');
  const r = build(page, reg);
  assert.equal(r.bids[0], reg.blocks[0].bid, 'and each keeps its own id across a reload');
  assert.equal(r.bids[2], reg.blocks[2].bid);
});

test('moving a block carries its id with it', () => {
  const before = [h2('A'), p('travels'), h2('B'), p('stays')];
  const reg = seed(before);
  const travels = reg.blocks[1].bid;
  const r = build([h2('A'), h2('B'), p('stays'), p('travels')], reg);
  assert.equal(r.bids[3], travels, 'matched by content wherever it went');
  assert.deepEqual(r.gone, []);
});

test('an emptied spec reports everything gone, and recovers when restored', () => {
  const page = [h2('A'), p('x')];
  const reg = seed(page);
  const emptied = build([], reg);
  assert.equal(emptied.gone.length, 2);
  assert.deepEqual(emptied.bids, []);
  // Restoring the same content produces NEW ids — the old ones were retired.
  const restored = build(page, emptied.registry);
  assert.equal(restored.gone.length, 0);
  assert.equal(new Set(restored.bids).size, 2);
});

test('a deletion is remembered on EVERY later reconcile, not just the one that saw it', () => {
  // The load that notices a deletion rewrites the registry. If "gone" were the
  // only signal, the next load would compare against the already-updated list,
  // see nothing missing, and silently un-orphan the comment — which is exactly
  // the old broken behaviour wearing a new hat.
  const reg = seed([h2('A'), p('doomed'), h2('B')]);
  const doomed = reg.blocks[1].bid;

  const first = build([h2('A'), h2('B')], reg);
  assert.deepEqual(first.gone, [doomed], 'seen on the reconcile that observed it');
  assert.ok(first.registry.retired.includes(doomed), 'and recorded');

  const second = build([h2('A'), h2('B')], first.registry);
  assert.deepEqual(second.gone, [], 'nothing NEW vanished');
  assert.ok(second.registry.retired.includes(doomed), 'but it is still known to be gone');
  assert.equal(second.changed, false, 'and that costs no extra write');
});

test('re-adding the same text later is a NEW block, and the old id stays retired', () => {
  // Deliberately no resurrection: once a block is deleted its id is retired for
  // good, and identical text appearing later is a new block. Reviving ids would
  // mean keeping every dead block's content forever to match against, to rescue
  // an undo that the reconcile cannot tell apart from someone writing the same
  // sentence again. The comment on the deleted block stays honestly orphaned.
  const reg = seed([h2('A'), p('comes back'), h2('B')]);
  const dead = reg.blocks[1].bid;
  const gone = build([h2('A'), h2('B')], reg);
  assert.ok(gone.registry.retired.includes(dead));

  const back = build([h2('A'), p('comes back'), h2('B')], gone.registry);
  assert.notEqual(back.bids[1], dead, 'a new block, not a resurrection');
  assert.ok(gone.registry.retired.includes(dead), 'and the dead id is still retired');
});

test('ids are never reused after a delete', () => {
  const reg = seed([p('one'), p('two')]);
  const afterDelete = build([p('one')], reg);
  const afterAdd = build([p('one'), p('three')], afterDelete.registry);
  assert.ok(!afterDelete.gone.includes(afterAdd.bids[1]), 'a new block cannot inherit a retired id');
});

test('a missing, malformed or future registry is treated as absent, never thrown', () => {
  const page = [p('a'), p('b')];
  for (const bad of [null, undefined, {}, { blocks: 'nope' }, { schema: 999, blocks: [] }, { schema: SCHEMA }]) {
    const r = reconcile(page, bad);
    assert.equal(r.bids.length, 2, `rebuilt from ${JSON.stringify(bad)}`);
    assert.deepEqual(r.gone, [], 'nothing can be "gone" when we never knew anything');
    assert.ok(r.changed);
  }
});

test('hashBlock separates tag from text', () => {
  assert.notEqual(hashBlock('P', 'Testing'), hashBlock('H2', 'Testing'),
    'same words in a different tag is a different block');
  assert.equal(hashBlock('P', 'a  b'), hashBlock('P', ' a b '), 'whitespace is normalised');
});

test('a large document still reconciles (the greedy fallback path)', () => {
  const page = Array.from({ length: 2100 }, (_, i) => p('para ' + i));
  const reg = seed(page);
  assert.equal(reg.blocks.length, 2100);
  const edited = page.slice();
  edited[1000] = p('para 1000 — edited');
  const r = build(edited, reg);
  assert.equal(r.bids[999], reg.blocks[999].bid, 'blocks around the edit are pinned');
  assert.equal(r.bids[1001], reg.blocks[1001].bid);
  assert.equal(r.bids[1000], reg.blocks[1000].bid, 'and the edited one keeps its id');
});

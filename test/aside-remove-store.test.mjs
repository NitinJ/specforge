// Removing an aside from the store: the section and its threads together.
//
// Two files change, and the order matters. Threads go first: an aside removed
// from the spec with its threads still in comments.json leaves threads anchored
// to a section that is not there, which the reconcile then tries to re-attach to
// whatever text is nearest. A thread that survives its aside is worse than one
// deleted with it, because it comes back attached to something the reader never
// commented on.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'sf-aside-rm-'));
process.env.SPECFORGE_HOME = HOME;

const { removeAside } = await import('../lib/actions/remove-aside.mjs');
const { loadComments, saveComments } = await import('../lib/store-comments.mjs');
const { readSpecHtml, writeSpecHtml } = await import('../lib/store.mjs');
const { specDir } = await import('../lib/store-paths.mjs');

const SPEC = `<!doctype html><html><body><main>
  <section id="object"><h2>1 · Object</h2><p>First.</p></section>
  <section id="object-aside-1" data-sf-aside="object" data-sf-action="visualize">
    <h3>Aside: Visualize</h3><figure><img alt="d"></figure></section>
</main></body></html>`;

function seed(id, threads) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: 'T', status: 'draft' }));
  writeSpecHtml(id, SPEC);
  saveComments(id, { specId: id, threads });
  return id;
}

const thread = (tid, section) => ({
  id: tid,
  state: 'open',
  anchor: { block: { index: 0, tag: 'P', text: 'x', sectionPath: [section], bid: 'b1' } },
  comments: [{ id: 'c1', kind: 'human', author: 'nitin', body: 'hi' }],
});

test('the aside leaves the spec and its threads leave the store', () => {
  const id = seed('sp_a', [thread('th_1', 'object-aside-1'), thread('th_2', 'object')]);
  const out = removeAside(id, 'object-aside-1');

  assert.equal(readSpecHtml(id).includes('object-aside-1'), false, 'gone from the spec');
  assert.deepEqual(loadComments(id).threads.map((t) => t.id), ['th_2'], 'only its own threads go');
  assert.equal(out.threads, 1, 'and it reports how many');
});

test('a section that is not an aside is refused and nothing is written', () => {
  const id = seed('sp_b', [thread('th_1', 'object')]);
  assert.throws(() => removeAside(id, 'object'), /not an aside/);
  assert.equal(readSpecHtml(id).includes('id="object"'), true);
  assert.deepEqual(loadComments(id).threads.map((t) => t.id), ['th_1'], 'threads untouched');
});

test('an unknown id is refused and nothing is written', () => {
  const id = seed('sp_c', [thread('th_1', 'object')]);
  assert.throws(() => removeAside(id, 'nope'), /no section/);
  assert.deepEqual(loadComments(id).threads.map((t) => t.id), ['th_1']);
});

test('an aside with no threads on it deletes cleanly', () => {
  const id = seed('sp_d', [thread('th_1', 'object')]);
  const out = removeAside(id, 'object-aside-1');
  assert.equal(out.threads, 0);
  assert.deepEqual(loadComments(id).threads.map((t) => t.id), ['th_1']);
});

test('a spec write that fails leaves the comments alone', () => {
  // Neither write is transactional with the other, so the order is chosen by
  // which half-done state survives. Comments deleted for a spec write that then
  // failed are silent and permanent, since nothing in the store is versioned;
  // threads orphaned the other way are visible and fixable. So the spec goes
  // first, and this is the failure that proves the order.
  const id = seed('sp_f', [thread('th_1', 'object-aside-1')]);
  chmodSync(join(specDir(id), 'spec.html'), 0o444);
  try {
    assert.throws(() => removeAside(id, 'object-aside-1'));
    assert.deepEqual(
      loadComments(id).threads.map((t) => t.id), ['th_1'],
      'the comments on the draft survived the failure',
    );
    assert.equal(readSpecHtml(id).includes('object-aside-1'), true, 'and so did the draft');
  } finally {
    chmodSync(join(specDir(id), 'spec.html'), 0o644);
  }
});

test('the spec is only written once the delete is known to be legal', () => {
  // The refusal cases above prove nothing was written; this proves the write
  // that does happen produces a readable file rather than a truncated one.
  const id = seed('sp_e', []);
  removeAside(id, 'object-aside-1');
  const html = readSpecHtml(id);
  assert.equal((html.match(/<section\b/g) || []).length, 1);
  assert.equal((html.match(/<\/section>/g) || []).length, 1);
  assert.equal(readFileSync(join(specDir(id), 'spec.html'), 'utf8'), html);
});

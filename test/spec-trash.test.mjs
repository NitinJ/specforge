// Deletion, trash and restore, at the store layer.
//
// Deletion used to be `rmSync`: one directory, gone. A delete that takes a whole
// subtree makes that unacceptable, because one mistaken click would take four
// specs with no way back. So a delete now MOVES directories into trash and
// writes one record naming everything it moved, and restore puts them back.
//
// The case worth the most attention is the partial failure: some moved, one
// threw. What must never happen is a half-done delete that reports success, or
// one that leaves a record claiming to restore specs that were never moved.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { moverFailingAt, recordingMover } from './helpers/fs-probe.mjs';
import {
  deleteSpec, deleteSubtree, restoreDeletion, listDeletions,
} from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specDir, trashRecordPath, trashSpecDir } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-trash-');

// ── a single spec ───────────────────────────────────────────────────────────

test('deleting one spec moves it to trash instead of unlinking it', () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId, removed } = deleteSubtree(id);

  assert.deepEqual(removed, [id]);
  assert.equal(existsSync(specDir(id)), false, 'the spec is out of the store');
  assert.equal(existsSync(trashSpecDir(deletionId, id)), true, 'the directory is in trash');
  assert.equal(readMeta(id), null);
});

test('a single delete writes a record, so single and subtree restore the same way', () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId } = deleteSubtree(id);

  const record = JSON.parse(readFileSync(trashRecordPath(deletionId), 'utf8'));
  assert.equal(record.deletionId, deletionId);
  assert.equal(record.rootId, id);
  assert.equal(record.rootTitle, 'Doomed');
  assert.equal(typeof record.deletedAt, 'number');
  assert.deepEqual(record.specs.map((s) => s.id), [id]);
});

test('deleting a spec that does not exist reports nothing removed', () => {
  const out = deleteSubtree('0000000000');
  assert.deepEqual(out.removed, []);
  assert.equal(out.deletionId, null);
});

// ── a subtree ───────────────────────────────────────────────────────────────

test('deleting a parent takes the whole subtree', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: a });

  const { removed } = deleteSubtree(root);
  assert.equal(removed.length, 4);
  assert.deepEqual([...removed].sort(), [root, a, b, grand].sort());
  for (const id of [root, a, b, grand]) assert.equal(existsSync(specDir(id)), false);
});

test('a subtree delete writes one record naming every spec it moved', () => {
  const { root, children } = buildShape('fan');
  const { deletionId, removed } = deleteSubtree(root);

  const record = JSON.parse(readFileSync(trashRecordPath(deletionId), 'utf8'));
  assert.equal(record.specs.length, 5);
  assert.deepEqual(record.specs.map((s) => s.id).sort(), removed.sort());
  // Each entry carries the parent it had, which is what makes the restored tree
  // the same tree rather than five roots.
  for (const child of children) {
    assert.equal(record.specs.find((s) => s.id === child).parent, root);
  }
  assert.equal(record.specs.find((s) => s.id === root).parent, null);
});

test('deleting a child leaves its parent alone', () => {
  const { root, children } = buildShape('fan');
  deleteSubtree(children[0]);

  assert.equal(existsSync(specDir(root)), true);
  assert.equal(readMeta(children[1]).parent, root);
});

test('a detached child survives its former parent being deleted', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  // What detaching is for: the escape hatch before a cascade.
  const meta = readMeta(child);
  meta.parent = null;
  writeFileSync(`${specDir(child)}/meta.json`, JSON.stringify(meta));

  const { removed } = deleteSubtree(root);
  assert.deepEqual(removed, [root]);
  assert.equal(existsSync(specDir(child)), true);
});

test('specs are moved deepest first, so a parent never outlives its child in trash', () => {
  const { ids } = buildShape('chain5');
  const { move, calls } = recordingMover();
  deleteSubtree(ids[0], { move });

  const order = calls.map(([from]) => basename(from));
  assert.deepEqual(order, [...ids].reverse());
});

// ── restore ─────────────────────────────────────────────────────────────────

test('restore brings the whole subtree back with its relations', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: a });

  const { deletionId } = deleteSubtree(root);
  const { restored } = restoreDeletion(deletionId);

  assert.equal(restored.length, 3);
  assert.equal(readMeta(root).parent, null);
  assert.equal(readMeta(a).parent, root);
  assert.equal(readMeta(grand).parent, a);
});

test('restore removes the record, so a deletion cannot be restored twice', () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId } = deleteSubtree(id);

  restoreDeletion(deletionId);
  assert.equal(existsSync(trashRecordPath(deletionId)), false);
  assert.throws(() => restoreDeletion(deletionId), /no such deletion/i);
});

test('restore refuses when a spec id is back in the store, and moves nothing', () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId } = deleteSubtree(id);

  // The id is taken again. Overwriting a live spec is not a restore.
  seedSpec({ id, title: 'A different spec with the same id' });

  assert.throws(() => restoreDeletion(deletionId), /already in the store/i);
  assert.equal(readMeta(id).title, 'A different spec with the same id');
  assert.equal(existsSync(trashRecordPath(deletionId)), true, 'the record survives a refusal');
});

test('restore of an unknown deletion id throws rather than doing nothing quietly', () => {
  assert.throws(() => restoreDeletion('0000000000'), /no such deletion/i);
});

test('restore refuses a deletion id that would escape the trash', () => {
  assert.throws(() => restoreDeletion('../../etc'), /spec id/i);
});

// ── listing ─────────────────────────────────────────────────────────────────

test('listDeletions reports what can be restored, newest first', () => {
  const first = seedSpec({ title: 'First' });
  const second = seedSpec({ title: 'Second' });

  const a = deleteSubtree(first);
  const b = deleteSubtree(second);

  const listed = listDeletions();
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((d) => d.deletionId), [b.deletionId, a.deletionId]);
  assert.equal(listed[0].rootTitle, 'Second');
  assert.equal(listed[0].count, 1);
});

test('listDeletions is empty on a store that has never deleted anything', () => {
  assert.deepEqual(listDeletions(), []);
});

// ── partial failure ─────────────────────────────────────────────────────────

test('a delete that fails partway reports what it moved, and stays restorable', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B', parent: a });

  const { move, calls } = moverFailingAt(2);
  let err;
  try {
    deleteSubtree(root, { move });
  } catch (e) {
    err = e;
  }

  assert.ok(err, 'a failed delete must throw rather than report success');
  assert.equal(err.removed.length, 1, 'the first spec was moved');
  assert.equal(calls.length, 2);
  // The record is written BEFORE the first move, so a delete that failed
  // partway leaves what it moved recoverable rather than stranded. Restore
  // tolerates an entry whose directory was never moved.
  assert.equal(existsSync(trashRecordPath(err.deletionId)), true);
  // The specs that were not reached are untouched.
  assert.equal(existsSync(specDir(root)), true);
});

test('a partial delete is still restorable, because the record is written first', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  seedSpec({ title: 'B', parent: a });

  const { move } = moverFailingAt(2);
  let err;
  try {
    deleteSubtree(root, { move });
  } catch (e) {
    err = e;
  }

  // Writing the record after the moves meant a delete that moved three
  // directories and then failed left all three with nothing naming them. The
  // record now exists first, and restore tolerates an entry whose directory was
  // never moved, so the failure costs nothing that cannot be undone.
  assert.ok(existsSync(trashRecordPath(err.deletionId)), 'a failed delete stranded what it moved');

  const { restored } = restoreDeletion(err.deletionId);
  assert.deepEqual(restored, err.removed);
  assert.equal(readMeta(err.removed[0]) !== null, true, 'the moved spec did not come back');
});

test('a partial delete names the spec that actually failed', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B', parent: a });

  const { move } = moverFailingAt(2);
  let err;
  try {
    deleteSubtree(root, { move });
  } catch (e) {
    err = e;
  }

  // Deepest first, so the order is B, A, root and the second call is A. Taking
  // failedAt from the root-first list reported `root`, which the loop had not
  // reached.
  assert.deepEqual(err.removed, [b]);
  assert.equal(err.failedAt, a);
});

test('a restore that failed partway can be retried rather than being stuck', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  seedSpec({ title: 'B', parent: a });

  const { deletionId } = deleteSubtree(root);

  // Fail the second move back, leaving one spec live and two in trash.
  const failing = moverFailingAt(2);
  assert.throws(() => restoreDeletion(deletionId, { move: failing.move }));

  // The retry must not refuse on the spec the first attempt already returned:
  // that id is live AND no longer in trash, which is not a collision.
  const { restored, alreadyBack } = restoreDeletion(deletionId);
  assert.equal(alreadyBack.length, 1, 'the already-restored spec was not recognised');
  assert.equal(restored.length + alreadyBack.length, 3);
  for (const id of [root, a]) assert.ok(readMeta(id), `${id} is still missing`);
});

test('a genuine id collision is still refused', () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId } = deleteSubtree(id);
  // Live AND still in trash: the real collision, and the one restore must refuse.
  seedSpec({ id, title: 'A different spec' });
  assert.throws(() => restoreDeletion(deletionId), /already in the store/i);
});

test('a partial delete leaves the moved directories in trash for a human to find', () => {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });

  const { move } = moverFailingAt(2);
  let err;
  try {
    deleteSubtree(root, { move });
  } catch (e) {
    err = e;
  }

  assert.equal(existsSync(trashSpecDir(err.deletionId, err.removed[0])), true);
});

// ── the old entry point still works ─────────────────────────────────────────

test('deleteSpec still deletes one spec and reports whether it existed', () => {
  const id = seedSpec({ title: 'Solo' });
  assert.equal(deleteSpec(id), true);
  assert.equal(existsSync(specDir(id)), false);
  assert.equal(deleteSpec('0000000000'), false);
});

test('deleteSpec does not take a subtree: that is deleteSubtree', () => {
  const { root, children } = buildShape('fan');
  deleteSpec(root);
  assert.equal(existsSync(specDir(root)), false);
  assert.equal(existsSync(specDir(children[0])), true, 'deleteSpec must stay single-spec');
});


// ── a plan that went stale ──────────────────────────────────────────────────
//
// The DELETE route resolves the subtree, refuses a protected spec, revokes
// every share, and only then deletes — and revoking is a round trip. A reparent
// landing in that window leaves the plan describing a tree that no longer
// exists, so the plan is re-read against the store before anything moves.

test('a spec reparented out of the subtree is not deleted with it', () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const gone = seedSpec({ title: 'Detached while the route was working' });

  // The plan names it, because it was a child when the plan was made.
  const { removed } = deleteSubtree(root, { ids: [root, child, gone] });

  assert.deepEqual(removed.sort(), [root, child].sort());
  assert.ok(readMeta(gone), 'a spec taken out of the tree was deleted anyway');
  assert.ok(existsSync(specDir(gone)));
});

test('the record names only what was actually moved', () => {
  const root = seedSpec({ title: 'Root' });
  const gone = seedSpec({ title: 'Not ours any more' });

  const { deletionId } = deleteSubtree(root, { ids: [root, gone] });
  const record = JSON.parse(readFileSync(trashRecordPath(deletionId), 'utf8'));
  assert.deepEqual(record.specs.map((s) => s.id), [root]);
});

test('a spec reparented INTO the subtree is left alone', () => {
  // The opposite direction, and deliberately not handled the same way. The
  // guards the route ran — the protected-spec check, the share revocation —
  // never ran against it, and deleting a spec whose share is still live is
  // worse than leaving one behind.
  const root = seedSpec({ title: 'Root' });
  const joined = seedSpec({ title: 'Joined late', parent: root });

  const { removed } = deleteSubtree(root, { ids: [root] });
  assert.deepEqual(removed, [root]);
  assert.ok(readMeta(joined), 'a spec the route never checked was deleted');
});

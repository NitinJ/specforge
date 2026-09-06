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

test('a delete that fails partway reports what it moved and writes no record', () => {
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
  assert.equal(
    existsSync(trashRecordPath(err.deletionId)),
    false,
    'no record: a partial delete is not restorable as a unit',
  );
  // The specs that were not reached are untouched.
  assert.equal(existsSync(specDir(root)), true);
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


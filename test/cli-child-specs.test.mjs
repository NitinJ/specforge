// The command line: making, moving and restoring child specs.
//
// This is how an agent works with the relation. Everything here is reachable
// over HTTP already; what the CLI adds is the shape an agent can use without
// composing requests, and exit codes it can act on.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec } from './helpers/spec-tree-fixtures.mjs';
import {
  cmdCreate, cmdReparent, cmdRestore, cmdListall, formatRowsCompact,
} from '../lib/specforge-cli.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specDir } from '../lib/store-paths.mjs';
import { deleteSubtree } from '../lib/store.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-clichild-');

// The CLI starts a daemon before touching the store. These tests are about the
// commands, so it is stubbed: a real one would bind a port per test.
const deps = { ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180' }), session: '' };

// ── create --parent ─────────────────────────────────────────────────────────

test('create --parent makes a child, and says whose', async () => {
  const root = seedSpec({ title: 'Design spec' });
  const out = await cmdCreate({ title: 'Testing', type: 'test-plan', parent: root }, deps);

  assert.equal(out.parent, root);
  assert.equal(out.parentTitle, 'Design spec');
  assert.equal(readMeta(out.id).parent, root);
});

test('create with no parent is unchanged', async () => {
  const out = await cmdCreate({ title: 'Standalone' }, deps);
  assert.equal(out.parent, null);
  assert.equal(readMeta(out.id).parent, null);
});

test('create --parent refuses a parent that does not exist', async () => {
  await assert.rejects(
    () => cmdCreate({ title: 'Orphan', parent: '0000000000' }, deps),
    /parent/i,
  );
});

test('create --parent inherits the project, so the child lands beside its parent', async () => {
  const root = seedSpec({ title: 'Root', project: 'specforge', collection: 'Store' });
  const out = await cmdCreate({ title: 'Child', parent: root }, deps);
  assert.equal(readMeta(out.id).project, 'specforge');
  assert.equal(readMeta(out.id).collection, 'Store');
});

// ── reparent ────────────────────────────────────────────────────────────────

test('reparent --to moves a spec under another', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child' });

  const out = await cmdReparent({ id: child, to: root }, deps);
  assert.equal(out.parent, root);
  assert.equal(readMeta(child).parent, root);
});

test('reparent --detach takes a spec out of its tree', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  const out = await cmdReparent({ id: child, detach: true }, deps);
  assert.equal(out.parent, null);
  assert.equal(readMeta(child).parent, null);
});

test('a detached spec survives its former parent being deleted', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  await cmdReparent({ id: child, detach: true }, deps);
  deleteSubtree(root);
  assert.equal(existsSync(specDir(child)), true, 'detaching did not save the child');
});

test('reparent refuses a cycle and names the chain', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  await assert.rejects(
    () => cmdReparent({ id: root, to: child }, deps),
    (err) => {
      assert.match(err.message, /cycle/i);
      // The chain that would have closed, so the message says what is wrong
      // rather than only that something is.
      assert.match(err.message, new RegExp(child));
      return true;
    },
  );
  assert.equal(readMeta(root).parent, null, 'a refused reparent moved the spec anyway');
});

test('reparent needs somewhere to go', async () => {
  const id = seedSpec({ title: 'Lonely' });
  await assert.rejects(() => cmdReparent({ id }, deps), /--to|--detach/);
});

test('reparent refuses a spec that does not exist', async () => {
  const root = seedSpec({ title: 'Root' });
  await assert.rejects(() => cmdReparent({ id: '0000000000', to: root }, deps), /not found/i);
});

// ── restore ─────────────────────────────────────────────────────────────────

test('restore with no id lists what can be restored', async () => {
  const root = seedSpec({ title: 'Root spec' });
  seedSpec({ title: 'Child', parent: root });
  const { deletionId } = deleteSubtree(root);

  const out = await cmdRestore({}, deps);
  assert.equal(out.deletions.length, 1);
  assert.equal(out.deletions[0].deletionId, deletionId);
  assert.equal(out.deletions[0].rootTitle, 'Root spec');
  assert.equal(out.deletions[0].count, 2);
});

test('restore puts a subtree back', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const { deletionId } = deleteSubtree(root);

  const out = await cmdRestore({ deletionId }, deps);
  assert.equal(out.restored.length, 2);
  assert.equal(readMeta(child).parent, root);
});

test('restore refuses an id that means nothing', async () => {
  await assert.rejects(() => cmdRestore({ deletionId: '0000000000' }, deps), /no such deletion/i);
});

test('restore refuses when the id is back in the store', async () => {
  const id = seedSpec({ title: 'Doomed' });
  const { deletionId } = deleteSubtree(id);
  seedSpec({ id, title: 'A different spec' });

  await assert.rejects(() => cmdRestore({ deletionId }, deps), /already in the store/i);
});

// ── listall ─────────────────────────────────────────────────────────────────

test('listall reports the parent of every spec that has one', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });

  const { rows } = await cmdListall({}, deps);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[root].parent, '');
  assert.equal(byId[child].parent, root);
});

test('the compact listing keeps one line per spec, with a parent column', async () => {
  const root = seedSpec({ title: 'Root' });
  const child = seedSpec({ title: 'Child', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: child });

  const { rows } = await cmdListall({}, deps);
  const lines = formatRowsCompact(rows).split('\n');

  // Flat and one line each, so the listing stays parseable line by line: it is
  // read by an agent as much as by a person.
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(line.includes('\n'), false);

  const byId = Object.fromEntries(lines.map((l) => [l.split('  ')[0], l]));
  assert.match(byId[child], new RegExp(root), "a child's line does not name its parent");
  assert.match(byId[grand], new RegExp(child));
  // The root has none, and an empty column reads as one, not as a missing field.
  assert.doesNotMatch(byId[root], /\bundefined\b/);
});

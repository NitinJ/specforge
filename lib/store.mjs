// The v2 global spec store: one tree at ~/.specforge for all specs, the single
// source of truth (design §3/§4). Replaces v1's per-project
// <project>/specs/.specforge/ layout. Per-spec state (comments/inbox/idx) mirrors
// v1 but is rooted at the global store dir instead of the project tree.
//
// Layout:
//   <STORE_ROOT>/specs/<id>/spec.html      the spec (canonical)
//                          /meta.json       lifecycle + ownership (see meta.mjs)
//                          /comments.json   review threads
//                          /inbox/<batchId>.json
//                          /idx.json        spec-nav index
//   <STORE_ROOT>/trash/<deletionId>/<id>/   what one delete moved
//   <STORE_ROOT>/trash/<deletionId>.json    the record naming all of them
//
// Deletion moves rather than unlinks, and spans a subtree: deleting a spec that
// has children takes them with it, so it has to be undoable. deleteSubtree and
// restoreDeletion are that pair; deleteSpec stays single-spec and final.
//
// Pure path/id helpers live in store-paths.mjs (the bottom layer); this module
// adds content + lifecycle operations on top, and re-exports the path helpers so
// callers keep importing them from store.mjs.

import {
  mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { getTitle, setTitle } from './spec.mjs';
import {
  storeRoot, specsDir, newSpecId, specDir, specHtmlPath,
  metaPath, commentsPath, inboxDir, idxPath, assertSpecId,
  trashDir, trashDeletionDir, trashSpecDir, trashRecordPath,
} from './store-paths.mjs';
import { defaultMeta, readMeta, writeMeta } from './meta.mjs';
import { descendantsOf, ancestryOf } from './spec-tree.mjs';

// Re-export the path helpers — stable public API (callers import them from here).
export {
  storeRoot, specsDir, newSpecId, specDir, specHtmlPath,
  metaPath, commentsPath, inboxDir, idxPath,
};

/** Ids of all specs in the store (dirs under specs/ that contain a meta.json). */
export function listSpecIds() {
  const root = specsDir();
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'meta.json')))
    .map((e) => e.name);
}

/**
 * Derive a display title from spec HTML: prefer <h1>, then <title> (via
 * spec.mjs#getTitle), else 'Untitled'.
 */
export function extractTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const t = h1[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  const title = getTitle(html);
  if (title && title !== 'Untitled spec') return title;
  return 'Untitled';
}

/**
 * Create a new spec in the store: mkdir its dir, write spec.html + meta.json.
 * Title is taken from `title` if given, else extracted from the HTML.
 *
 * `parent` makes it a child spec. The parent must already exist: a spec whose
 * parent is missing renders at top level and belongs to nothing, which is a
 * state worth tolerating when an interrupted delete causes it and worth
 * refusing when a caller asks for it.
 *
 * A child with no `project` or `collection` of its own takes its parent's. Those
 * two fields decide where a row is drawn on the home page, and a child filed
 * somewhere its parent is not would be drawn under a parent that is not on
 * screen. It is a default, not a link: neither field follows `parent` afterwards,
 * so moving the parent or reparenting the child leaves the child where it is.
 * Pass either explicitly, including `''`, to override.
 *
 * @returns {string} the new spec id
 */
export function createSpec({
  title, origin = null, html = '', type, parent = null, project, collection,
} = {}) {
  let parentMeta = null;
  if (parent) {
    assertSpecId(parent);
    parentMeta = readMeta(parent);
    if (!parentMeta) throw new Error(`parent spec not found: ${parent}`);
  }

  const id = newSpecId();
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html);
  const resolvedTitle = title || extractTitle(html);

  const meta = defaultMeta({ id, title: resolvedTitle, origin, type });
  meta.parent = parent || null;
  // `undefined` means the caller said nothing, so the parent's value applies.
  // `''` and null are answers, and are kept.
  meta.project = project === undefined ? (parentMeta ? parentMeta.project ?? null : null) : project;
  meta.collection = collection === undefined
    ? (parentMeta ? parentMeta.collection ?? null : null)
    : collection;

  writeMeta(id, meta);
  return id;
}

/** Read a spec's spec.html (throws if missing). */
export function readSpecHtml(id) {
  return readFileSync(specHtmlPath(id), 'utf8');
}

/**
 * Delete ONE spec: remove its whole store dir (spec.html + meta + comments +
 * inbox + idx). Caller owns any session-lock cleanup (detach) beforehand.
 *
 * Still an unlink, and still single-spec. `deleteSubtree` is the recoverable
 * one, and it is what the DELETE route calls; this stays for callers that mean
 * exactly one spec and no undo.
 *
 * @returns {boolean} true if the spec existed and was removed, false if absent.
 */
export function deleteSpec(id) {
  if (!readMeta(id)) return false;
  rmSync(specDir(id), { recursive: true, force: true });
  return true;
}

/** The default move: rename the directory, creating the destination's parent. */
function moveDir(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

/**
 * Delete a spec and everything below it, recoverably.
 *
 * Two things make this different from `deleteSpec`. It spans the subtree, so one
 * action can remove four specs; and because of that it MOVES each directory into
 * `~/.specforge/trash/<deletionId>/` rather than unlinking it, then writes one
 * record naming everything it moved. Without the record a subtree delete would
 * be four separate undos, and without the move there would be no undo at all.
 *
 * Order is deepest first, so a parent's directory is never taken out from under
 * a child that has not moved yet.
 *
 * Partial failure throws rather than reporting success, and deliberately writes
 * NO record: a record listing specs that were not moved would offer a restore
 * that cannot work. The error carries `deletionId` and `removed` so a caller can
 * say what happened and a human can find the directories.
 *
 * @param {string} id the root of the subtree
 * @param {{move?: Function, before?: Function}} [opts] `move` is injectable so a
 *   test can fail one; `before` runs per spec before its move (the route uses it
 *   to revoke a share and detach a session).
 * @returns {{deletionId: string|null, removed: string[]}}
 */
/**
 * A deletion stamp newer than every record already in the trash.
 *
 * Date.now() alone is not enough twice over. It has a millisecond of resolution
 * and deleting a spec takes less than one, so two deletions in a row tied and
 * the listing fell back to whatever order readdir gave — and undo acts on the
 * first row. And a restart or a clock stepping backwards puts today's deletion
 * behind yesterday's, which is the same failure with a longer fuse.
 *
 * So the answer comes off disk rather than out of a variable: whatever is in the
 * trash now, plus one, or the wall clock if that is later. Deletions are rare
 * enough that one directory scan is nothing.
 *
 * Read-then-write, so two processes racing could still tie. The daemon is a
 * loopback singleton and there is not a second one; a tie between two of them
 * would cost an ordering in a listing, which is not worth a lock file.
 */
function nextDeletionStamp() {
  const newest = listDeletions().reduce((max, d) => Math.max(max, d.deletedAt || 0), 0);
  return Math.max(Date.now(), newest + 1);
}

export function deleteSubtree(id, { move = moveDir, before, ids: planned } = {}) {
  const rootMeta = readMeta(id);
  if (!rootMeta) return { deletionId: null, removed: [] };

  // The caller may hand in the set it already resolved. The DELETE route does:
  // it reads the plan, refuses a protected spec and revokes every share before
  // anything moves, and recomputing here would delete a different set from the
  // one those guards ran against if a concurrent reparent landed in between.
  // The caller's plan is pruned, never extended. A spec reparented out of the
  // subtree while the route was revoking shares is no longer part of this
  // deletion and must not be moved; one reparented IN is left where it is,
  // because the guards the route ran — the protected-spec check, the share
  // revocation — never ran against it, and deleting a spec whose share is still
  // live is the worse of the two. The re-read is the last thing before the
  // record is written, and nothing between here and the final move yields.
  const ids = (planned && planned.length ? planned : descendantsOf(id))
    .filter((specId) => specId === id || ancestryOf(specId).includes(id));
  const deletionId = newSpecId();
  const removed = [];
  const deletedAt = nextDeletionStamp();

  // Read every meta BEFORE moving anything, and write the record BEFORE the
  // first move. Two reasons, both about the failure case:
  //
  //   the record is what makes a deletion restorable, so a delete that moved
  //   five directories and then failed to write it would strand all five with
  //   nothing naming them;
  //   restore tolerates an entry whose directory is not in trash, so a record
  //   naming more than was moved costs nothing, while a move with no record
  //   costs everything.
  const entries = ids
    .map((specId) => ({ specId, meta: readMeta(specId) }))
    .filter((x) => x.meta)
    // spec-tree-ok: records each spec's own value so restore rebuilds the tree
    .map((x) => ({ id: x.specId, parent: x.meta.parent || null }));

  // The record lands before the first move, so the directory it sits in has to
  // exist now rather than being created by the first move as it used to be.
  mkdirSync(trashDir(), { recursive: true });
  writeFileSync(trashRecordPath(deletionId), JSON.stringify({
    deletionId,
    rootId: id,
    // Carried so a listing can name the deletion without reading each moved meta.
    rootTitle: rootMeta.title || id,
    deletedAt,
    specs: entries,
  }, null, 2));

  try {
    // Deepest last in descendantsOf's order, so reverse to move deepest first.
    for (const specId of [...ids].reverse()) {
      if (!readMeta(specId)) continue;
      if (before) before(specId);
      move(specDir(specId), trashSpecDir(deletionId, specId));
      removed.push(specId);
    }
  } catch (cause) {
    const err = new Error(`delete failed after ${removed.length} of ${ids.length}: ${cause.message}`);
    err.cause = cause;
    err.deletionId = deletionId;
    err.removed = removed;
    // The one that threw, which is the next in the order the loop was walking.
    // Taking it from the root-first list instead named an id the loop had not
    // reached yet.
    err.failedAt = [...ids].reverse().find((x) => !removed.includes(x)) || null;
    throw err;
  }

  return { deletionId, removed };
}

/** Every deletion that can still be restored, newest first. */
export function listDeletions() {
  let names;
  try {
    names = readdirSync(trashDir());
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(trashDir(), name), 'utf8'));
      out.push({
        deletionId: record.deletionId,
        rootId: record.rootId,
        rootTitle: record.rootTitle,
        deletedAt: record.deletedAt,
        count: (record.specs || []).length,
      });
    } catch {
      // A record we cannot parse is not restorable; leaving it out of the list
      // is better than failing the whole listing.
    }
  }
  // Newest first, with a tiebreak: two deletes in the same millisecond is not a
  // hypothetical, and a listing that reorders itself between reads is worse than
  // one in an arbitrary but fixed order.
  return out.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)
    || String(a.deletionId).localeCompare(String(b.deletionId)));
}

/**
 * Put back everything one deletion moved.
 *
 * Refuses rather than overwrites when an id is back in the store: reusing an id
 * is unlikely, and silently replacing a live spec with an older one of the same
 * name is the kind of data loss an undo is supposed to prevent.
 *
 * A CONFLICT is an id that is live in the store AND still sitting in this
 * deletion's trash, which is the only shape a real collision has. An id that is
 * live and no longer in trash is one this same restore already put back, so it
 * is skipped rather than refused: a restore that failed partway would otherwise
 * be permanently stuck, refusing on the specs it had already returned.
 *
 * The check runs over every id before anything moves, so a refusal leaves trash
 * untouched and the record in place to try again.
 *
 * @param {string} deletionId
 * @param {{move?: Function}} [opts]
 * @returns {{restored: string[], alreadyBack: string[]}}
 */
export function restoreDeletion(deletionId, { move = moveDir } = {}) {
  const path = trashRecordPath(deletionId);
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`no such deletion: ${deletionId}`);
  }

  const specs = record.specs || [];
  const alreadyBack = [];
  for (const entry of specs) {
    const inTrash = existsSync(trashSpecDir(deletionId, entry.id));
    if (!readMeta(entry.id)) continue;
    if (inTrash) throw new Error(`cannot restore ${entry.id}: already in the store`);
    alreadyBack.push(entry.id);
  }

  const restored = [];
  // Shallowest first, the reverse of the delete, so a parent is back before its
  // children land beside it.
  for (const entry of [...specs].reverse()) {
    const from = trashSpecDir(deletionId, entry.id);
    if (!existsSync(from)) continue;
    move(from, specDir(entry.id));
    restored.push(entry.id);
  }

  rmSync(path, { force: true });
  rmSync(trashDeletionDir(deletionId), { recursive: true, force: true });
  return { restored, alreadyBack };
}

/**
 * Rename a spec: set meta.title AND rewrite the spec's own <h1>/<title> so the
 * document heading tracks the listing name. Returns the updated meta, or null if
 * the spec doesn't exist. (writeSpecHtml bumps `updated` + triggers the live reload.)
 */
export function renameSpec(id, title) {
  const meta = readMeta(id);
  if (!meta) return null;
  writeSpecHtml(id, setTitle(readSpecHtml(id), title));
  const m = readMeta(id); // re-read: writeSpecHtml just bumped `updated`
  m.title = title;
  return writeMeta(id, m);
}

/**
 * Write a spec's spec.html (creates the spec dir if needed). Bumps meta.updated
 * so a content change is reflected in the spec's modification time — callers
 * reading meta.updated after a write see the current time, not the last meta edit.
 */
export function writeSpecHtml(id, html) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html);
  const m = readMeta(id);
  if (m) writeMeta(id, m); // writeMeta() bumps `updated`
}

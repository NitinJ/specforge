// The parent edge, and the only module that walks it.
//
// A child spec records which spec it belongs to in one field, `meta.parent`.
// There is no `children` array on the parent: a second copy of the same fact can
// disagree with the first after an interrupted write, and the store has no
// transactions. So the reverse direction is a scan of every meta, which is the
// same shape `specsOfType` already uses to answer "which specs carry this type".
//
// Four modules ask these questions directly (store-api, store, flatten-tree,
// gateway) and two more reach them through the API (index-page, the CLI). The
// walk lives here rather than in each of them because three behaviours have to
// be decided once and identically:
//
//   1. A `parent` naming a spec that no longer exists is IGNORED, not an error.
//      An interrupted delete can leave one, and a store that throws on read
//      would be unopenable until someone edited JSON by hand.
//   2. A cycle TERMINATES. The API refuses to create one, so a cycle can only
//      come from a hand-edited meta.json, and the answer to that is a walk that
//      stops rather than a daemon that hangs.
//   3. Ids are validated before use, INCLUDING the ones read off disk.
//      `assertSpecId` is the path-traversal guard, and `metaPath` does not call
//      it: it joins whatever it is given. A `parent` of `../../../etc` in a
//      hand-edited meta.json would otherwise send the ancestry walk outside the
//      store. See `parentOf`.
//
// Cost: each call reads every meta.json in the store. Measured 2026-09-06: 210
// files, mean 382 bytes, 78 KB total. No cache, because a cache is the one
// structure here that could disagree with the field.

import { listSpecs, readMeta } from './meta.mjs';
import { assertSpecId } from './store-paths.mjs';

/**
 * The parent id a meta names, or null. Absent, empty and null all read null.
 *
 * A value that is not a valid store id also reads null, and that check is the
 * one that matters. `metaPath` does not validate: it joins whatever it is given
 * onto the store path. So a `parent` of `../../../etc` in a hand-edited
 * meta.json would make the ancestry walk read and parse a file outside the
 * store. The field comes off disk, which makes it input, and it is checked here
 * rather than at each of the three call sites because one of them forgetting is
 * how that hole reopens.
 */
function parentOf(meta) {
  // spec-tree-ok: this module owns the walk; this is the read it is named for
  const raw = meta && meta.parent ? meta.parent : null;
  if (!raw) return null;
  try {
    assertSpecId(raw);
  } catch {
    return null;
  }
  return raw;
}

/**
 * The specs naming `id` as their parent, one level down.
 *
 * Sorted by `created` so two reads of an unchanged store give the same order,
 * which is what lets a sidebar render without reordering under the reader.
 *
 * @param {string} id
 * @returns {object[]} their metas
 */
export function childrenOf(id) {
  assertSpecId(id);
  // A spec that is not there has no children, even when something still points
  // at it. Without this, an orphan left by an interrupted delete would be
  // returned as a child of a spec that does not exist, and childrenOf would
  // disagree with descendantsOf and ancestryOf, which both ignore that edge.
  if (!readMeta(id)) return [];
  return listSpecs()
    .filter((m) => parentOf(m) === id)
    .sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Which of `ids` have children of their own, in one scan.
 *
 * The reason this exists rather than a `childrenOf` per row: `childrenOf` reads
 * every meta in the store, so asking it once per child made listing a wide
 * parent cost children x specs synchronous reads. One pass answers it for all of
 * them.
 *
 * @param {string[]} ids
 * @param {(childId: string) => boolean} [keep] which children count. A reader
 *   holding a project token cannot open a child filed elsewhere, so one must
 *   not make its parent offer a way down into an empty drawer.
 * @returns {Set<string>} the subset that is somebody's parent
 */
export function childIdsWithChildren(ids, keep = () => true) {
  const wanted = new Set(ids);
  const out = new Set();
  if (!wanted.size) return out;
  for (const meta of listSpecs()) {
    const p = parentOf(meta);
    if (p && wanted.has(p) && keep(meta.id)) out.add(p);
  }
  return out;
}

/**
 * `id` and everything below it, depth first, root first, each id once.
 *
 * Empty when the spec does not exist, so a caller can treat "no such spec" and
 * "nothing to do" the same way. The visited set is what makes a hand-written
 * cycle terminate.
 *
 * @param {string} id
 * @returns {string[]}
 */
export function descendantsOf(id) {
  assertSpecId(id);
  if (!readMeta(id)) return [];

  // One scan, then walk the index. Recursing with a fresh listSpecs() per node
  // would read the store once per spec in the subtree.
  const byParent = new Map();
  for (const m of listSpecs()) {
    const p = parentOf(m);
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(m);
  }
  for (const kids of byParent.values()) {
    kids.sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id)));
  }

  const out = [];
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    const kids = byParent.get(current) || [];
    // Reversed, because a stack pops last-in first: this keeps siblings in
    // creation order in the output.
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].id);
  }
  return out;
}

/**
 * The chain from the root of `id`'s tree down to `id`, root first.
 *
 * Stops at a parent that does not exist, and at a repeated id, so both broken
 * shapes give a partial answer rather than a hang.
 *
 * @param {string} id
 * @returns {string[]}
 */
export function ancestryOf(id) {
  assertSpecId(id);
  const meta = readMeta(id);
  if (!meta) return [];

  const chain = [id];
  const seen = new Set([id]);
  let current = parentOf(meta);
  while (current) {
    if (seen.has(current)) break;
    const m = readMeta(current);
    if (!m) break;
    chain.push(current);
    seen.add(current);
    current = parentOf(m);
  }
  return chain.reverse();
}

/**
 * Would setting `id`'s parent to `nextParent` close a loop?
 *
 * Asked before every write that sets the field. Detaching (`null`) can never
 * make a cycle, and re-setting the parent a spec already has is a no-op rather
 * than a self-reference.
 *
 * @param {string} id the spec being moved
 * @param {string|null} nextParent
 * @returns {boolean}
 */
export function wouldCycle(id, nextParent) {
  assertSpecId(id);
  if (!nextParent) return false;
  assertSpecId(nextParent);
  if (nextParent === id) return true;
  return descendantsOf(id).includes(nextParent);
}

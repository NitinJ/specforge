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
//
// Pure path/id helpers live in store-paths.mjs (the bottom layer); this module
// adds content + lifecycle operations on top, and re-exports the path helpers so
// callers keep importing them from store.mjs.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getTitle, setTitle } from './spec.mjs';
import {
  storeRoot, specsDir, newSpecId, specDir, specHtmlPath,
  metaPath, commentsPath, inboxDir, idxPath, assertSpecId,
} from './store-paths.mjs';
import { defaultMeta, readMeta, writeMeta } from './meta.mjs';

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
 * Delete a spec: remove its whole store dir (spec.html + meta + comments +
 * inbox + idx). Caller owns any session-lock cleanup (detach) beforehand.
 * @returns {boolean} true if the spec existed and was removed, false if absent.
 */
export function deleteSpec(id) {
  if (!readMeta(id)) return false;
  rmSync(specDir(id), { recursive: true, force: true });
  return true;
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

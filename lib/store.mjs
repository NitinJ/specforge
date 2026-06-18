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

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTitle } from './spec.mjs';
import {
  storeRoot, specsDir, newSpecId, specDir, specHtmlPath,
  metaPath, commentsPath, inboxDir, idxPath,
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
 * @returns {string} the new spec id
 */
export function createSpec({ title, origin = null, html = '', type } = {}) {
  const id = newSpecId();
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html);
  const resolvedTitle = title || extractTitle(html);
  writeMeta(id, defaultMeta({ id, title: resolvedTitle, origin, type }));
  return id;
}

/** Read a spec's spec.html (throws if missing). */
export function readSpecHtml(id) {
  return readFileSync(specHtmlPath(id), 'utf8');
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

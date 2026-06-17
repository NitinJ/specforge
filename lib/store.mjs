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
// The root is read at call time (not import time) so tests can point
// SPECFORGE_HOME at a temp dir before invoking.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { getTitle } from './spec.mjs';
import { defaultMeta, writeMeta } from './meta.mjs';

/** Store root: SPECFORGE_HOME override (for tests) or ~/.specforge. */
export function storeRoot() {
  return process.env.SPECFORGE_HOME || join(homedir(), '.specforge');
}

/** Directory holding all spec dirs: <STORE_ROOT>/specs. */
export function specsDir() {
  return join(storeRoot(), 'specs');
}

/** A new opaque, stable spec id: sha1(uuid)[:10]. */
export function newSpecId() {
  return createHash('sha1').update(randomUUID()).digest('hex').slice(0, 10);
}

export function specDir(id) {
  return join(specsDir(), id);
}
export function specHtmlPath(id) {
  return join(specDir(id), 'spec.html');
}
export function metaPath(id) {
  return join(specDir(id), 'meta.json');
}
export function commentsPath(id) {
  return join(specDir(id), 'comments.json');
}
export function inboxDir(id) {
  return join(specDir(id), 'inbox');
}
export function idxPath(id) {
  return join(specDir(id), 'idx.json');
}

/** Ids of all specs in the store (dirs under specs/ that contain a meta.json). */
export function listSpecIds() {
  let entries;
  try {
    entries = readdirSync(specsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(specsDir(), e.name, 'meta.json')))
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
export function createSpec({ title, origin = null, html = '' }) {
  const id = newSpecId();
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html);
  const resolvedTitle = title || extractTitle(html);
  writeMeta(id, defaultMeta({ id, title: resolvedTitle, origin }));
  return id;
}

/** Read a spec's spec.html (throws if missing). */
export function readSpecHtml(id) {
  return readFileSync(specHtmlPath(id), 'utf8');
}

/** Write a spec's spec.html (creates the spec dir if needed). */
export function writeSpecHtml(id, html) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html);
}

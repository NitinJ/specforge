// Pure path + id helpers for the v2 global spec store — the bottom layer that
// both store.mjs and meta.mjs import, so neither imports the other just for path
// resolution (this is what breaks the store↔meta dependency cycle).
//
// The root is read at call time (not import time) so tests can point
// SPECFORGE_HOME at a temp dir before invoking.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

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

/** Directory holding per-session reverse-index files: <STORE_ROOT>/sessions. */
export function sessionsDir() {
  return join(storeRoot(), 'sessions');
}
/** A session's reverse-index file: which spec ids it owns (derived/rebuildable). */
export function sessionPath(sessionId) {
  return join(sessionsDir(), `${sessionId}.json`);
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
export function commentsLockPath(id) {
  return join(specDir(id), 'comments.lock');
}
export function inboxDir(id) {
  return join(specDir(id), 'inbox');
}
export function idxPath(id) {
  return join(specDir(id), 'idx.json');
}
export function uiPath(id) {
  return join(specDir(id), 'ui.json');
}
export function ledgerPath(id) {
  return join(specDir(id), 'ledger.json');
}

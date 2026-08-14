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

/**
 * Store ids that are not specs.
 *
 * The component library document lives under specs/ with a spec's layout, so the
 * comments API, the review batches and the live-reload watcher all resolve it the
 * way they resolve everything else. What makes it not a spec is this set: it is
 * absent from every list, the spec routes do not serve it, and `sync` skips it.
 *
 * Here rather than beside the document itself because meta.mjs is the module that
 * has to know, and it sits below components-doc.mjs in the import order.
 */
export const RESERVED_IDS = new Set(['specforge-components']);

/** Whether an id names a reserved store entry rather than a spec. */
export function isReservedId(id) {
  return RESERVED_IDS.has(id);
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
/** The block registry — SpecForge's memory of this spec's block sequence, so
 *  comments keep their place across edits. Derived and disposable: deleting it
 *  costs nothing but the ids it remembered. */
export function blocksPath(id) {
  return join(specDir(id), 'blocks.json');
}
/** A published spec's record: its token. Absent means it is not published. The
 *  public origin lives in tunnelPath(), not here, because one tunnel serves
 *  every published spec and its origin must be able to change without
 *  rewriting a record per spec. */
export function sharePath(id) {
  return join(specDir(id), 'share.json');
}
/** The one tunnel exposing the gateway, at <STORE_ROOT>/tunnel.json. Absent
 *  means nothing is exposed. Holds the pid, which is the only route back to a
 *  cloudflared child that outlived the daemon that spawned it. */
export function tunnelPath() {
  return join(storeRoot(), 'tunnel.json');
}
/** Store-wide settings, at <STORE_ROOT>/config.json. Absent means all defaults. */
export function configPath() {
  return join(storeRoot(), 'config.json');
}
/** Store-wide UI prefs (the index page's theme), at <STORE_ROOT>/ui.json. */
export function globalUiPath() {
  return join(storeRoot(), 'ui.json');
}
export function ledgerPath(id) {
  return join(specDir(id), 'ledger.json');
}

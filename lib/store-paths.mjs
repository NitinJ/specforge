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
 *
 * Written id to route, because a reserved entry is reached at its own path or not
 * at all and three places need to agree on which: the daemon that routes it, the
 * client that prints its url, and the spec route that refuses it. One map, so a
 * third reserved document is one entry rather than three edits that can disagree.
 */
export const RESERVED_ROUTES = new Map([
  ['specforge-components', '/components'],
  ['specforge-components-interactive', '/components-interactive'],
]);

export const RESERVED_IDS = new Set(RESERVED_ROUTES.keys());

/** Whether an id names a reserved store entry rather than a spec. */
export function isReservedId(id) {
  return RESERVED_IDS.has(id);
}

/** The path a reserved entry is served at, or null for anything else. */
export function reservedRoute(id) {
  return RESERVED_ROUTES.get(id) || null;
}

/** The reserved id a route belongs to, or null. */
export function reservedIdForRoute(path) {
  for (const [id, route] of RESERVED_ROUTES) if (route === path) return id;
  return null;
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

/**
 * The shape of every id this store makes: sha1 hex, or a reserved/template name.
 *
 * Enforced rather than assumed, because an id arrives from a person's request
 * and travels through a path join and, in a skill, through a shell command. A
 * store id has never contained anything but these characters, so the check costs
 * nothing and turns a traversal or an injection into an error naming the id.
 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Throw unless `id` has the shape of a store id. */
export function assertSpecId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`not a spec id: ${JSON.stringify(id)}`);
  }
  return id;
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
/**
 * Serializes read-modify-write on meta.json.
 *
 * Its own lock rather than the comments one: they guard unrelated files, and a
 * beat waiting on a comment reply would be a queue nobody asked for.
 */
export function metaLockPath(id) {
  return join(specDir(id), 'meta.lock');
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
/** Project-share records, at <STORE_ROOT>/project-shares.json. One file for all
 *  of them, because a project is a name on spec meta rather than a directory,
 *  so there is no per-project place for a record to live. */
export function projectSharesPath() {
  return join(storeRoot(), 'project-shares.json');
}
/** Subscriptions to other people's shared projects, at
 *  <STORE_ROOT>/subscriptions.json. Pointers only, never content. */
export function subscriptionsPath() {
  return join(storeRoot(), 'subscriptions.json');
}
/** Where this machine's specs are listed in other people's projects, at
 *  <STORE_ROOT>/contributed.json. The record of which spec token each entry
 *  was registered under, so a rotated share can still be withdrawn. */
export function contributedPath() {
  return join(storeRoot(), 'contributed.json');
}
/** Store-wide settings, at <STORE_ROOT>/config.json. Absent means all defaults. */
export function configPath() {
  return join(storeRoot(), 'config.json');
}
/** Store-wide UI prefs (the index page's theme), at <STORE_ROOT>/ui.json. */
export function globalUiPath() {
  return join(storeRoot(), 'ui.json');
}
/** User prompt customizations, at <STORE_ROOT>/prompts.json. Absent until
 *  something is customized, which is the state every store ships in: the
 *  shipped defaults apply alone and the file's absence is not an error. */
export function promptsPath() {
  return join(storeRoot(), 'prompts.json');
}
/** Kinds of spec the user added, at <STORE_ROOT>/types.json. Absent until one is
 *  added, which is the state every store ships in: the six built-in kinds apply
 *  alone and the file's absence is not an error. */
export function typesPath() {
  return join(storeRoot(), 'types.json');
}
export function ledgerPath(id) {
  return join(specDir(id), 'ledger.json');
}

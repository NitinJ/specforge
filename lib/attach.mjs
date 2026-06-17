// Session attachment & locking for the v2 global store (design §6).
//
// The enabler is $CLAUDE_CODE_SESSION_ID — present in every Bash subprocess and
// hook env. A spec is owned by at most one session at a time (exclusive lock on
// meta.attachedSession). 1 session ↔ many specs; 1 spec ↔ 1 session.
//
// There is no SessionEnd hook, so a lock can't be released on exit. Instead the
// session's hooks bump meta.heartbeat each turn, and a lock older than STALE_MS
// is reclaimable by another session — a crashed/closed session never wedges a
// spec permanently.
//
// meta.json (per-spec) is the source of truth. sessions/<id>.json is a
// convenience reverse index so hooks/list don't scan every spec; it is
// derived/rebuildable, and specsForSession() filters it against meta so a stale
// index can never hand back a spec the session no longer owns.
//
// Plain writes, no compare-and-set (KISS — single user; design §10).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readMeta, writeMeta } from './meta.mjs';
import { sessionsDir, sessionPath } from './store-paths.mjs';

/** A lock idle this long (ms) is reclaimable by another session. */
export const STALE_MS = 30 * 60 * 1000;

/** True if `meta` is attached but its heartbeat is older than STALE_MS. */
export function isStale(meta) {
  if (!meta || !meta.attachedSession) return false;
  return Date.now() - (meta.heartbeat || 0) > STALE_MS;
}

function readSessionIndex(sessionId) {
  try {
    const idx = JSON.parse(readFileSync(sessionPath(sessionId), 'utf8'));
    return Array.isArray(idx.specs) ? idx.specs : [];
  } catch {
    return [];
  }
}

function writeSessionIndex(sessionId, specs) {
  mkdirSync(sessionsDir(), { recursive: true });
  writeFileSync(sessionPath(sessionId), JSON.stringify({ specs }, null, 2));
}

function addToSession(sessionId, specId) {
  const specs = readSessionIndex(sessionId);
  if (!specs.includes(specId)) {
    specs.push(specId);
    writeSessionIndex(sessionId, specs);
  }
}

function removeFromSession(sessionId, specId) {
  const specs = readSessionIndex(sessionId);
  const next = specs.filter((s) => s !== specId);
  if (next.length !== specs.length) writeSessionIndex(sessionId, next);
}

/**
 * Spec ids attached to `sessionId`. Reads the reverse index, then filters by
 * meta.attachedSession (the source of truth) so a stale index self-heals.
 */
export function specsForSession(sessionId) {
  if (!sessionId) return [];
  return readSessionIndex(sessionId).filter((id) => {
    const meta = readMeta(id);
    return meta && meta.attachedSession === sessionId;
  });
}

/**
 * Attach `specId` to `sessionId` (exclusive). Throws if another, non-stale
 * session owns it. Idempotent for the owning session. Reclaims a stale lock.
 * @returns {object} the updated meta
 */
export function attach(specId, sessionId) {
  const meta = readMeta(specId);
  if (!meta) throw new Error(`unknown spec ${specId}`);
  const owner = meta.attachedSession;
  if (owner && owner !== sessionId && !isStale(meta)) {
    throw new Error(`spec ${specId} is attached to another session`);
  }
  if (owner && owner !== sessionId) removeFromSession(owner, specId); // reclaim
  meta.attachedSession = sessionId;
  meta.heartbeat = Date.now();
  const written = writeMeta(specId, meta);
  addToSession(sessionId, specId);
  return written;
}

/** Detach `specId` from whatever session owns it (the "clicking detaches" UX). */
export function detach(specId) {
  const meta = readMeta(specId);
  if (!meta) return;
  const owner = meta.attachedSession;
  meta.attachedSession = null;
  writeMeta(specId, meta);
  if (owner) removeFromSession(owner, specId);
}

/** Bump meta.heartbeat for every spec `sessionId` owns. @returns {number} count */
export function heartbeat(sessionId) {
  const ids = specsForSession(sessionId);
  const now = Date.now();
  for (const id of ids) {
    const meta = readMeta(id);
    if (meta) writeMeta(id, { ...meta, heartbeat: now });
  }
  return ids.length;
}

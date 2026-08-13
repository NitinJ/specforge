// Session attachment & locking for the v2 global store (design §6).
//
// The enabler is $CLAUDE_CODE_SESSION_ID — present in every Bash subprocess and
// hook env. A spec is owned by at most one session at a time (exclusive lock on
// meta.attachedSession). 1 session ↔ many specs; 1 spec ↔ 1 session.
//
// There is no SessionEnd hook, so a lock can't be released on exit. Instead the
// owning session bumps meta.heartbeat, and a lock older than STALE_MS is
// reclaimable by another session — a crashed/closed session never wedges a spec
// permanently.
//
// The heartbeat answers exactly one question: if a reviewer submitted comments
// right now, would an agent pick them up on its own? Only the review watcher
// (`specforge wait-batch`) can answer yes, because it is the only thing polling
// for batches while the session sits idle — so it is the only thing that writes
// the heartbeat. The hooks deliberately do not. They fire when the human takes a
// turn in that window, which says the session exists but nothing about whether
// anything is listening, and stamping them made every spec anyone had ever
// opened read as connected for half an hour after the window closed.
//
// meta.json (per-spec) is the source of truth. sessions/<id>.json is a
// convenience reverse index so hooks/list don't scan every spec; it is
// derived/rebuildable, and specsForSession() filters it against meta so a stale
// index can never hand back a spec the session no longer owns.
//
// Plain writes, no compare-and-set (KISS — single user; design §10).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readMeta, writeMeta } from './meta.mjs';
import { sessionsDir, sessionPath, metaPath } from './store-paths.mjs';

/** A lock idle this long (ms) is reclaimable by another session. */
export const STALE_MS = 30 * 60 * 1000;

/** How often the review watcher beats. The watcher and the UI must agree on it. */
export const HEARTBEAT_MS = 15 * 1000;

/**
 * A spec is disconnected once two beats have been missed.
 *
 * Deliberately far shorter than STALE_MS, because the two answer different
 * questions. This one is "is anyone listening", which the reader needs to be
 * true *now*. STALE_MS is "may another session take this lock", where being
 * hasty costs a session the spec it is working on, so it stays generous.
 */
export const CONNECTED_MS = 2 * HEARTBEAT_MS;

/**
 * True if nothing has been heard from the owning session for STALE_MS, so
 * another may take the lock.
 *
 * Reads the later of the two signals on purpose. `heartbeat` is a watcher beat
 * and answers "is anyone listening"; `seen` is a turn in that window and answers
 * only "does that session still exist" — which is the weaker claim, and exactly
 * the right one for a lock. A session editing a spec for an hour without ever
 * arming a watcher is still using it, and letting another session reclaim it
 * underneath would route its review work somewhere else.
 */
export function isStale(meta) {
  if (!meta || !meta.attachedSession) return false;
  const last = Math.max(meta.heartbeat || 0, meta.seen || 0);
  return Date.now() - last > STALE_MS;
}

/**
 * True if a watcher is beating for this spec right now — so a batch submitted
 * this second would be picked up without anyone touching that session.
 */
export function isConnected(meta) {
  if (!meta || !meta.attachedSession) return false;
  return Date.now() - (meta.heartbeat || 0) <= CONNECTED_MS;
}

/** The whole session record: `{ specs, watcherPid }`. */
function readSessionRecord(sessionId) {
  try {
    const idx = JSON.parse(readFileSync(sessionPath(sessionId), 'utf8'));
    return { specs: Array.isArray(idx.specs) ? idx.specs : [], watcherPid: idx.watcherPid || null };
  } catch {
    return { specs: [], watcherPid: null };
  }
}

/** Merge `patch` into the session record, leaving the other fields alone. */
function writeSessionRecord(sessionId, patch) {
  mkdirSync(sessionsDir(), { recursive: true });
  const next = { ...readSessionRecord(sessionId), ...patch };
  writeFileSync(sessionPath(sessionId), JSON.stringify(next, null, 2));
}

function readSessionIndex(sessionId) {
  return readSessionRecord(sessionId).specs;
}

function addToSession(sessionId, specId) {
  const specs = readSessionIndex(sessionId);
  if (!specs.includes(specId)) writeSessionRecord(sessionId, { specs: specs.concat(specId) });
}

function removeFromSession(sessionId, specId) {
  const specs = readSessionIndex(sessionId);
  const next = specs.filter((s) => s !== specId);
  if (next.length !== specs.length) writeSessionRecord(sessionId, { specs: next });
}

/**
 * Record that a watcher process is running for this session, and stop recording
 * it when the process ends.
 *
 * The pid, not the heartbeat, is what answers "is a watcher running". A beat
 * proves one happened recently, which is the right approximation for the browser
 * badge but wrong at the boundary that matters here: `wait-batch` exits the
 * instant it delivers a batch, so for the next thirty seconds its last beat is
 * still fresh while no watcher exists at all. That window is exactly when an
 * agent finishes the review and settles, which is exactly when it needed telling.
 */
export function setWatcher(sessionId, pid) {
  if (sessionId) writeSessionRecord(sessionId, { watcherPid: pid });
}
export function clearWatcher(sessionId) {
  if (sessionId) writeSessionRecord(sessionId, { watcherPid: null });
}

/**
 * Is a watcher process alive for this session?
 *
 * signal 0 tests existence without touching the process. A hard-killed watcher
 * leaves its record behind and is caught here; the residual risk is that its pid
 * gets reused by something unrelated before the next check, which costs one
 * missed reminder and corrects itself on the following one.
 */
export function watcherAlive(sessionId, alive = pidAlive) {
  const { watcherPid } = readSessionRecord(sessionId);
  return !!watcherPid && alive(watcherPid);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
    // The post-crash trap: the owner may be a dead session whose lock has not
    // yet gone stale. Make the error self-serve — say who holds it, when it
    // frees itself, and how to free it now (there is no ownership check on
    // detach precisely so a human/agent can recover a crashed session's spec).
    const age = Date.now() - Math.max(meta.heartbeat || 0, meta.seen || 0);
    const staleInMin = Math.max(1, Math.ceil((STALE_MS - age) / 60000));
    throw new Error(
      `spec ${specId} is attached to another session (${String(owner).slice(0, 8)}, ` +
      `last seen ${Math.floor(age / 60000)}m ago — lock goes stale in ~${staleInMin}m). ` +
      `If that session is gone (crash/restart), free it now: ` +
      `run the specforge CLI "detach ${specId}", then retry.`
    );
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

/**
 * Bump meta.heartbeat for every spec `sessionId` owns. Called by the review
 * watcher on each poll, and by nothing else.
 *
 * Written straight to meta.json rather than through writeMeta, which stamps
 * `updated` on every call. A beat is not an edit to the document: stamping it
 * every 15s pinned `updated` to the present for every attached spec, which made
 * the index's recency sort meaningless and its "2d ago" column a lie.
 *
 * @returns {number} count
 */
export function heartbeat(sessionId) {
  return stamp(sessionId, 'heartbeat');
}

/**
 * Note that `sessionId` still exists, without claiming anything is listening.
 * Called by the hooks each turn, and read only by the lock (see isStale).
 */
export function markSeen(sessionId) {
  return stamp(sessionId, 'seen');
}

/**
 * Written straight to meta.json rather than through writeMeta, which stamps
 * `updated` on every call. Neither of these is an edit to the document: doing it
 * every 15s pinned `updated` to the present for every attached spec, which made
 * the index's recency sort meaningless and its "2d ago" column a lie.
 */
function stamp(sessionId, field) {
  const ids = specsForSession(sessionId);
  const now = Date.now();
  for (const id of ids) {
    const meta = readMeta(id);
    if (meta) writeFileSync(metaPath(id), JSON.stringify({ ...meta, [field]: now }, null, 2));
  }
  return ids.length;
}

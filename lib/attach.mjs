// Session attachment & locking for the v2 global store (design §6).
//
// A session is named by a key the running harness supplies (lib/harness/), which
// is `<harness>:<raw id>` so two CLIs on one machine cannot collide. A key with
// no harness in it predates this and reads as Claude Code, which is what every
// record already in the store is. A spec is owned by at most one session at a
// time (exclusive lock on meta.attachedSession). 1 session ↔ many specs;
// 1 spec ↔ 1 session.
//
// No CLI reports session end, so a lock can't be released on exit. Instead the
// owning session bumps meta.heartbeat, and a lock older than STALE_MS is
// reclaimable by another session, so a crashed or closed session never wedges a
// spec permanently.
//
// The heartbeat answers exactly one question: if a reviewer submitted comments
// right now, would an agent pick them up on its own? Only the review watcher
// (`specforge wait-batch`) can answer yes, because it is the only thing polling
// for batches while the session sits idle, so it is the only thing that writes
// the heartbeat. The session events deliberately do not. They fire when the human
// takes a turn in that window, which says the session exists but nothing about
// whether anything is listening, and stamping them made every spec anyone had
// ever opened read as connected for half an hour after the window closed.
//
// A spec can also be CONNECTED to more than one harness while being worked by
// one: lib/connections.mjs holds that set, and meta.attachedSession stays the
// active one, which is what keeps every reader here meaning what it meant.
//
// meta.json (per-spec) is the source of truth. sessions/<key>.json is a
// convenience reverse index so the session events and `list` don't scan every
// spec; it is derived and rebuildable, and specsForSession() filters it against
// meta so a stale index can never hand back a spec the session no longer owns.
//
// Plain writes, no compare-and-set (KISS — single user; design §10).

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { readMeta, writeMeta } from './meta.mjs';
import { sessionsDir, sessionPath, metaPath } from './store-paths.mjs';
import { normalizeKey, sameSession, encodeKey, decodeKey, parseKey, harnessOf } from './session-key.mjs';

/**
 * The file a session's record lives in.
 *
 * Every path in this module goes through here. A session is named by a key, and
 * a key carries a colon that Windows reserves, so the two forms are not the same
 * string (I12). A Claude Code key encodes back to the bare id it has always
 * been, so no record on disk moves.
 */
function recordPath(sessionId) {
  const name = encodeKey(normalizeKey(sessionId));
  // encodeKey refuses a key it cannot store as one safe path segment. Passing
  // that on would write `sessions/.json`, a single shared file every unsafe
  // session would then collide in.
  return name ? sessionPath(name) : null;
}

/**
 * A key short enough for an error message, with the harness kept.
 *
 * Truncating the whole key to 8 characters used to be enough when a key was a
 * raw id. It now yields `claude:s`, which names nothing. The harness is the part
 * a reader most needs when two CLIs are in play, so it survives whole and the
 * raw id is what gets shortened.
 */
export function shortKey(key) {
  const { harness, raw } = parseKey(String(key || ''));
  return `${harness}:${String(raw).slice(0, 8)}`;
}

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
  const path = recordPath(sessionId);
  if (!path) return { specs: [], watcherPid: null };
  try {
    const idx = JSON.parse(readFileSync(path, 'utf8'));
    return { specs: Array.isArray(idx.specs) ? idx.specs : [], watcherPid: idx.watcherPid || null };
  } catch {
    return { specs: [], watcherPid: null };
  }
}

/** Merge `patch` into the session record, leaving the other fields alone. */
function writeSessionRecord(sessionId, patch) {
  const path = recordPath(sessionId);
  if (!path) return;
  mkdirSync(sessionsDir(), { recursive: true });
  const next = { ...readSessionRecord(sessionId), ...patch };
  writeFileSync(path, JSON.stringify(next, null, 2));
}

function readSessionIndex(sessionId) {
  return readSessionRecord(sessionId).specs;
}

function addToSession(sessionId, specId) {
  const specs = readSessionIndex(sessionId);
  if (!specs.includes(specId)) writeSessionRecord(sessionId, { specs: specs.concat(specId) });
}

/**
 * Put a spec in a session's reverse index without making it the active one.
 *
 * What `connect` needs: the index is how a session finds its specs without
 * scanning every one, and a connection nothing indexes is a connection nothing
 * can look up. Exported rather than duplicated so there is one writer of the
 * index (lib/connections.mjs imports it; nothing here imports back).
 */
export function indexSpecForSession(sessionId, specId) {
  if (sessionId && specId) addToSession(normalizeKey(sessionId), specId);
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

/**
 * Every session with a watcher running right now, most recently written first.
 *
 * Answers "is there an agent to hand work to", which is what a surface offering
 * to create something an agent must write has to know before it writes
 * anything. Reads the pid rather than the heartbeat, for the reason above: a
 * beat stays fresh for thirty seconds after `wait-batch` exits, and that window
 * is exactly when a session is between jobs.
 *
 * Sorted by the record's mtime so the caller can take the first and get the
 * session most recently doing something, rather than whichever the filesystem
 * happened to list first.
 */
export function liveSessions(alive = pidAlive) {
  let entries;
  try {
    entries = readdirSync(sessionsDir(), { withFileTypes: true });
  } catch {
    return []; // no sessions directory yet: nothing has ever attached
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    // Decoded, so a caller gets a key it can compare and print, not a filename.
    .map((e) => decodeKey(e.name.slice(0, -'.json'.length)))
    .filter((id) => watcherAlive(id, alive))
    .map((id) => {
      let at = 0;
      try { at = statSync(recordPath(id)).mtimeMs; } catch { /* raced a delete */ }
      return { id, at };
    })
    .sort((a, b) => b.at - a.at)
    .map((s) => s.id);
}

/**
 * Is this pid a running process?
 *
 * signal 0 tests existence without touching it. Exported so lib/connections.mjs
 * decides liveness the same way rather than growing a second answer.
 */
export function pidAlive(pid) {
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
    // sameSession, not ===: every spec in the store holds a bare session id, and
    // the running session reports a qualified key. Comparing the strings would
    // read all 111 of them as detached (I2).
    return meta && sameSession(meta.attachedSession, sessionId);
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
  const key = normalizeKey(sessionId);
  // A key with no storable record would attach a spec to a session nothing can
  // ever look up, which reads as owned and behaves as orphaned.
  if (!key || !recordPath(key)) throw new Error(`cannot attach ${specId}: unusable session id`);
  const owner = meta.attachedSession;
  const mine = sameSession(owner, key);
  if (owner && !mine && !isStale(meta)) {
    // The post-crash trap: the owner may be a dead session whose lock has not
    // yet gone stale. Make the error self-serve — say who holds it, when it
    // frees itself, and how to free it now (there is no ownership check on
    // detach precisely so a human/agent can recover a crashed session's spec).
    const age = Date.now() - Math.max(meta.heartbeat || 0, meta.seen || 0);
    const staleInMin = Math.max(1, Math.ceil((STALE_MS - age) / 60000));
    throw new Error(
      `spec ${specId} is attached to another session (${shortKey(owner)}, ` +
      `last seen ${Math.floor(age / 60000)}m ago — lock goes stale in ~${staleInMin}m). ` +
      `If that session is gone (crash/restart), free it now: ` +
      `run the specforge CLI "detach ${specId}", then retry.`
    );
  }
  if (owner && !mine) removeFromSession(owner, specId); // reclaim
  // The qualified key, so a spec touched after this upgrade records which CLI
  // holds it. An untouched spec keeps its bare id and still compares equal.
  meta.attachedSession = key;
  meta.heartbeat = Date.now();
  // Attaching also connects: `connections` is the set, `attachedSession` picks
  // the active one out of it, and the two must not disagree (stage 6).
  meta.connections = withConnection(meta, key);
  const written = writeMeta(specId, meta);
  addToSession(key, specId);
  return written;
}

/**
 * `connections` with this session's harness added or refreshed.
 *
 * Lives here rather than in lib/connections.mjs to keep the dependency one-way:
 * connections reads attach, and attach must not read it back.
 */
function withConnection(meta, key) {
  const harness = harnessOf(key);
  const existing = (meta.connections && typeof meta.connections === 'object') ? meta.connections : {};
  const prev = existing[harness];
  return {
    ...existing,
    [harness]: { session: key, lastBeat: Date.now(), watcherPid: prev?.watcherPid ?? null },
  };
}

/**
 * Detach `specId` from whatever session owns it (the "clicking detaches" UX).
 *
 * Drops that harness's connection too. Another harness still connected does not
 * become active on its own: P9 puts that choice with the human, and switching
 * on their behalf would move work to an agent they did not pick.
 */
export function detach(specId) {
  const meta = readMeta(specId);
  if (!meta) return;
  const owner = meta.attachedSession;
  meta.attachedSession = null;
  if (owner && meta.connections) {
    const next = { ...meta.connections };
    delete next[harnessOf(normalizeKey(owner))];
    meta.connections = next;
  }
  writeMeta(specId, meta);
  if (owner) removeFromSession(owner, specId);
}

/**
 * Spec ids this session is CONNECTED to, active or not.
 *
 * Deliberately separate from `specsForSession`, which stays active-only because
 * it is what routes batches: exactly one session may receive one (I9). This is
 * for the surfaces that report rather than route, such as `doctor`.
 */
export function specsConnectedTo(sessionKey) {
  if (!sessionKey) return [];
  const key = normalizeKey(sessionKey);
  return readSessionIndex(sessionKey).filter((id) => {
    const meta = readMeta(id);
    if (!meta) return false;
    if (sameSession(meta.attachedSession, key)) return true;
    const conn = (meta.connections || {})[harnessOf(key)];
    return Boolean(conn && sameSession(conn.session, key));
  });
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
  return stamp(sessionId, 'heartbeat', { beatConnection: true });
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
function stamp(sessionId, field, { beatConnection = false } = {}) {
  const mine = specsForSession(sessionId);
  // Two different scopes, because the two fields answer two different questions.
  //
  //   meta.<field>   is about the session WORKING the spec, so it follows the
  //                  active list. An inactive session bumping it would report
  //                  the wrong agent as listening.
  //   connections[h] is about this harness alone, so it has to cover every spec
  //                  this session is connected to.
  //
  // Beating only the active list is a defect that reached a live store: a
  // session connected to a spec another harness was working never beat it, so
  // its connection went stale in thirty seconds and read "needs reconnect" for
  // as long as the session lived. That is exactly the agent the reader is
  // trying to hand the spec to.
  const ids = beatConnection
    ? [...new Set([...mine, ...specsConnectedTo(sessionId)])]
    : mine;
  const active = new Set(mine);
  const now = Date.now();
  const key = normalizeKey(sessionId);
  const harness = harnessOf(key);
  const { watcherPid } = readSessionRecord(sessionId);
  for (const id of ids) {
    const meta = readMeta(id);
    if (!meta) continue;
    const next = active.has(id) ? { ...meta, [field]: now } : { ...meta };
    // A watcher beat is also this harness's own liveness (D12, P10), so the
    // header can say which connections need a reconnect rather than reporting
    // one state for the whole spec.
    if (beatConnection && key) {
      const conns = { ...(next.connections || {}) };
      const prev = conns[harness];
      if (!prev || sameSession(prev.session, key)) {
        conns[harness] = { session: key, lastBeat: now, watcherPid: watcherPid ?? prev?.watcherPid ?? null };
        next.connections = conns;
      }
    }
    writeFileSync(metaPath(id), JSON.stringify(next, null, 2));
  }
  return ids.length;
}

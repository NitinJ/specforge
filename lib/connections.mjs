// Which harnesses are connected to a spec, and which one is working on it.
//
// Attachment used to do two jobs: hear about a spec's comments, and be allowed
// to write it. This splits them.
//
//   meta.connections     a map of harness id to { session, lastBeat, watcherPid }
//   meta.attachedSession the ACTIVE session, unchanged in meaning
//
// Keeping `attachedSession` as the active one is what makes this a small change:
// every existing reader (specsForSession, batch routing, isConnected) goes on
// meaning what it meant, and the switcher moves that field between connections
// rather than introducing a second notion of ownership. The active harness is
// therefore derived, never stored twice.
//
// A spec with no `connections` field reads as one connection, derived from
// `attachedSession`. That is every one of the 111 specs in the store (E3).
//
// Nothing here lets an agent choose. `setActive` is reached only from the
// daemon's endpoint, which is the browser, which is a person (I7b, E8).
//
// Spec e9ddcddef6, stage 6.

import { readMeta, writeMeta, mutateMeta } from './meta.mjs';
import { metaPath, metaLockPath } from './store-paths.mjs';
import { withFileLock } from './file-lock.mjs';
import { writeFileSync } from 'node:fs';
import { harnessOf, normalizeKey, sameSession } from './session-key.mjs';
import { pidAlive, indexSpecForSession } from './attach.mjs';

/**
 * Every connection on a spec, keyed by harness id.
 *
 * Derived when the field is absent, so a spec written before this reads as the
 * one connection it has always had.
 */
export function connectionsOf(meta) {
  if (!meta) return {};
  const stored = meta.connections && typeof meta.connections === 'object' ? meta.connections : null;
  if (stored && Object.keys(stored).length) return stored;
  if (!meta.attachedSession) return {};
  const key = normalizeKey(meta.attachedSession);
  return {
    [harnessOf(key)]: {
      session: key,
      lastBeat: meta.heartbeat || 0,
      watcherPid: null, // unknown for a derived connection; liveness falls back to the beat
    },
  };
}

/** The harness currently allowed to write, or null when nothing is attached. */
export function activeHarnessOf(meta) {
  if (!meta || !meta.attachedSession) return null;
  return harnessOf(normalizeKey(meta.attachedSession));
}

/**
 * Is a connection alive?
 *
 * The pid, not the beat, whenever a pid is recorded: a beat stays fresh for
 * thirty seconds after `wait-batch` exits, and that window is exactly when a
 * session is between jobs (I11). A derived connection has no pid, so it falls
 * back to the beat, which is what the browser badge already showed.
 */
export function connectionAlive(conn, { now = Date.now(), connectedMs = 30000, alive = pidAlive } = {}) {
  if (!conn) return false;
  if (conn.watcherPid) return alive(conn.watcherPid);
  return now - (conn.lastBeat || 0) <= connectedMs;
}

/**
 * The connections on a spec, as the header renders them.
 *
 * @returns {{harness: string, session: string, active: boolean, alive: boolean}[]}
 */
export function connectionList(meta, opts = {}) {
  const active = activeHarnessOf(meta);
  return Object.entries(connectionsOf(meta))
    .map(([harness, conn]) => ({
      harness,
      session: conn.session,
      active: harness === active,
      alive: connectionAlive(conn, opts),
    }))
    .sort((a, b) => a.harness.localeCompare(b.harness));
}

/**
 * Add or refresh a connection, without touching which harness is active.
 *
 * Under the spec's lock, because this is the write with no second chance: a beat
 * that read meta a moment earlier would write a snapshot with no such connection
 * in it, and nothing later restores it. Every beat repairs itself; a connection
 * that never existed on disk does not.
 */
export function connect(specId, sessionKey, { watcherPid = null } = {}) {
  if (!readMeta(specId)) throw new Error(`unknown spec ${specId}`);
  const key = normalizeKey(sessionKey);
  if (!key) throw new Error(`connect: unusable session id for ${specId}`);
  const written = mutateMeta(specId, (meta) => {
    const next = { ...connectionsOf(meta) };
    next[harnessOf(key)] = {
      session: key,
      lastBeat: Date.now(),
      watcherPid: watcherPid ?? next[harnessOf(key)]?.watcherPid ?? null,
    };
    return { ...meta, connections: next };
  });
  // The reverse index too: it is how a session finds its specs without scanning
  // every one, and a connection nothing indexes is one nothing can look up.
  indexSpecForSession(key, specId);
  return written;
}

/** Drop a harness's connection. The active one going leaves the spec free. */
export function disconnect(specId, harnessId) {
  return mutateMeta(specId, (meta) => {
    const next = { ...connectionsOf(meta) };
    delete next[harnessId];
    return { ...meta, connections: next };
  });
}

/**
 * Make a connected harness the active one.
 *
 * A human action, from the browser. Refuses a harness that is not connected,
 * because activating one would name a session nothing can route to.
 *
 * @returns {{ok: boolean, error?: string, active?: string, session?: string}}
 */
export function setActive(specId, harnessId) {
  const meta = readMeta(specId);
  if (!meta) return { ok: false, error: `unknown spec ${specId}` };
  const conns = connectionsOf(meta);
  const conn = conns[harnessId];
  if (!conn) {
    const names = Object.keys(conns);
    return {
      ok: false,
      error: names.length
        ? `${harnessId} is not connected to this spec (connected: ${names.join(', ')})`
        : `nothing is connected to this spec`,
    };
  }
  if (sameSession(meta.attachedSession, conn.session)) {
    return { ok: true, active: harnessId, session: conn.session, changed: false };
  }
  // Under the lock, and re-reading inside it: handing the spec over is ownership,
  // and a beat landing on top of a stale snapshot would hand it back.
  mutateMeta(specId, (fresh) => ({
    ...fresh,
    attachedSession: conn.session,
    connections: connectionsOf(fresh),
  }));
  return { ok: true, active: harnessId, session: conn.session, changed: true };
}

/**
 * May this session write the spec's HTML?
 *
 * The whole of E7. Reading, replying to a comment and marking a batch need no
 * such check: a connected harness that is not active can still answer, which is
 * what makes connecting a second one worth doing at all (I10).
 */
export function canWrite(meta, sessionKey) {
  if (!meta) return false;
  if (!meta.attachedSession) return true; // nothing holds it
  return sameSession(meta.attachedSession, sessionKey);
}

/** Why a write was refused, in words a person can act on. */
export function writeRefusal(specId, meta) {
  const active = activeHarnessOf(meta);
  return `spec ${specId} is being worked on by the ${active} harness. `
    + 'Switch the active harness in the spec header to take it over.';
}

/**
 * Record this harness's watcher beat on its own connection (D12).
 *
 * Under the spec's lock, which is the same lock `mutateMeta` takes, so a beat
 * and an ownership change cannot interleave. It does not go THROUGH `mutateMeta`
 * because that stamps `updated` on every write: a beat is not an edit to the
 * document, and stamping it every 15s pinned `updated` to the present for every
 * attached spec, which made the index's recency sort meaningless.
 */
export function beatConnection(specId, sessionKey, watcherPid) {
  const key = normalizeKey(sessionKey);
  const harness = harnessOf(key);
  withFileLock(metaLockPath(specId), () => {
    const meta = readMeta(specId);
    if (!meta) return;
    const conns = { ...connectionsOf(meta) };
    const prev = conns[harness];
    // Only a session that IS this connection may beat for it.
    if (prev && !sameSession(prev.session, key)) return;
    conns[harness] = { session: key, lastBeat: Date.now(), watcherPid: watcherPid ?? prev?.watcherPid ?? null };
    writeFileSync(metaPath(specId), JSON.stringify({ ...meta, connections: conns }, null, 2));
  });
}

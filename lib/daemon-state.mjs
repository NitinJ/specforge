// Runtime state for the v2 global daemon (design §3/§5). One server per machine,
// so its advertised address + advisory lock live at the store root rather than in
// any project tree:
//
//   <STORE_ROOT>/server.json   { port, pid, url } of the running daemon (singleton)
//   <STORE_ROOT>/server.lock   advisory lock so only one daemon binds
//
// Rooted at storeRoot() (the global store) with a singleton lock + a pid-liveness
// check that ensureServer() uses to decide whether an advertised daemon can be
// trusted. (Supersedes v1's per-project lib/server-state.mjs.)

import { mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { storeRoot } from './store-paths.mjs';

export function serverStatePath() {
  return join(storeRoot(), 'server.json');
}
export function serverLockPath() {
  return join(storeRoot(), 'server.lock');
}

/** @param {{port:number, pid:number, url:string}} state */
export function writeServerState(state) {
  const p = serverStatePath();
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

/** @returns {{port:number, pid:number, url:string}|null} */
export function readServerState() {
  try {
    return JSON.parse(readFileSync(serverStatePath(), 'utf8'));
  } catch {
    return null;
  }
}

export function clearServerState() {
  try {
    rmSync(serverStatePath());
  } catch {
    /* already gone */
  }
}

/** GET /healthz against an advertised url; true iff it answers 200. */
export async function healthOk(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(new URL('/healthz', url), { signal: ctrl.signal });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Is a process alive? `process.kill(pid, 0)` probes without signalling. */
export function isAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but we can't signal it — still alive.
    return err.code === 'EPERM';
  }
}

/**
 * Try to take the advisory lock (O_EXCL create). Writes our pid into it.
 * @returns {boolean} true if we now hold the lock, false if it's already held.
 */
export function acquireLock(pid = process.pid) {
  mkdirSync(storeRoot(), { recursive: true });
  try {
    const fd = openSync(serverLockPath(), 'wx'); // wx = O_CREAT|O_EXCL|O_WRONLY
    writeFileSync(fd, String(pid));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

/** The pid recorded in the lockfile, or null if no/unreadable lock. */
export function lockHolderPid() {
  try {
    const pid = Number(readFileSync(serverLockPath(), 'utf8').trim());
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function releaseLock() {
  try {
    rmSync(serverLockPath());
  } catch {
    /* already gone */
  }
}

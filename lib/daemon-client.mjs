// Client side of the singleton daemon (design §5/§8). Commands are short-lived
// processes: they must NOT bind the server in-process (it would die when the
// command exits). Instead they reuse a healthy advertised daemon, or spawn one
// detached and wait for it to answer /healthz.
//
// (The daemon process itself uses ensureServer() in daemon.mjs, which binds
// in-process and stays alive — that is the other half of this pair.)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readServerState, isAlive } from './daemon-state.mjs';
import { healthOk } from '../server/daemon.mjs';

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'daemon.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True iff server.json advertises a live, healthy daemon. */
async function reusable() {
  const s = readServerState();
  if (s && isAlive(s.pid) && (await healthOk(s.url))) return { url: s.url, port: s.port };
  return null;
}

/**
 * Ensure a daemon is running and return its base url. Reuses a healthy one; else
 * spawns `node server/daemon.mjs` detached and polls /healthz until it is up.
 * @returns {Promise<{url:string, port:number}>}
 */
export async function ensureDaemon({ timeoutMs = 8000 } = {}) {
  const existing = await reusable();
  if (existing) return existing;

  const child = spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(100);
    const up = await reusable();
    if (up) return up;
  }
  throw new Error('SpecForge daemon did not come up');
}

/** The browser url for a spec id under a daemon base url. */
export function specUrl(baseUrl, id) {
  return new URL(`/spec/${id}`, baseUrl).href;
}

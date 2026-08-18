// Client side of the singleton daemon (design §5/§8). Commands are short-lived
// processes: they must NOT bind the server in-process (it would die when the
// command exits). Instead they reuse the daemon already holding the port, or
// spawn one detached and wait for it to answer /healthz.
//
// (The daemon process itself uses ensureServer() in daemon.mjs, which binds
// in-process and stays alive — that is the other half of this pair.)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { daemonAt, daemonUrl, defaultPort } from './daemon-state.mjs';
import { reservedRoute } from './store-paths.mjs';

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'daemon.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The running daemon, or null.
 *
 * One question, asked of the port itself: a daemon is running iff something is
 * holding the port and identifies as us. There is no record to consult and
 * therefore none to be wrong — the previous version read server.json and
 * health-checked whatever it named, which meant a record deleted by an unrelated
 * daemon's exit made a perfectly healthy daemon invisible, and every command
 * that looked then started another one.
 */
export async function reusable() {
  const url = daemonUrl();
  return (await daemonAt(url)) ? { url, port: defaultPort() } : null;
}

/**
 * Ensure a daemon is running and return its base url. Reuses the running one;
 * else spawns `node server/daemon.mjs` detached and polls /healthz until it is up.
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

/**
 * The browser url for a store id under a daemon base url.
 *
 * A reserved entry has its own route, and /spec/<reserved id> is a 404. Composed
 * here rather than at each caller because `open` prints this url, and the page
 * that tells a human to run `open` is the component library itself.
 */
export function specUrl(baseUrl, id) {
  return new URL(reservedRoute(id) || `/spec/${id}`, baseUrl).href;
}

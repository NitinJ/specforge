// Where the daemon is, and whether it is there.
//
// The answer is the port. Binding 127.0.0.1:4180 is the singleton election:
// the kernel admits exactly one holder, decides it atomically so there is no
// check-then-claim window for a second process to slip through, and releases it
// when that process dies for any reason at all — including SIGKILL, which no
// cleanup handler survives.
//
// This module used to be twice this size because it reimplemented that
// guarantee in files (`server.lock` to elect, `server.json` to advertise). The
// election half worked; the release half could not. A lock file has no owner as
// far as the OS is concerned, so a daemon that died badly left one behind
// forever, which forced a recorded pid to test for staleness, which the OS
// recycles, which forced a health check on top. Each patch closed a hole and
// opened a smaller one, and the whole tower sat under a `listenWithFallback`
// that walked to the next port when 4180 was busy — so a daemon that had just
// proved another one was running started anyway. That is where the orphans came
// from.
//
// Nothing here is written to disk. There is no state to go stale.

/** What /healthz says, so "something answers" can't be mistaken for "we do". */
export const SERVICE = 'specforge';

const FALLBACK_PORT = 4180;

/** How long a probe waits before calling the port empty. */
const PROBE_TIMEOUT_MS = 1000;

/**
 * The port the daemon binds.
 *
 * SPECFORGE_PORT exists for the test suite, which starts real daemons and must
 * not land on the real one's port and serve a throwaway store to every open
 * browser tab. It doubles as the escape hatch for the one case the old port walk
 * was defensible for: 4180 genuinely taken by something else.
 *
 * Read per call, not at import, so a test can set it after loading this module
 * (same reason storeRoot() re-reads SPECFORGE_HOME).
 */
export function defaultPort() {
  const p = Number(process.env.SPECFORGE_PORT);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : FALLBACK_PORT;
}

/** The daemon's base url. Derived, never recorded — the port is the address. */
export function daemonUrl(port = defaultPort()) {
  return `http://127.0.0.1:${port}/`;
}

/**
 * Ask whoever holds this url who they are.
 *
 * @returns {Promise<{service:string, pid:number}|null>} null when nothing
 *   answers, or when what answers is not a SpecForge daemon. The distinction
 *   matters: callers treat a live answer as "reuse this one" and its absence as
 *   "the port is mine to take (or to refuse)", and adopting a stranger would
 *   hand out spec urls that 404 with nothing to explain why.
 */
export async function daemonAt(url) {
  try {
    const res = await fetch(new URL('/healthz', url), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const body = await res.json();
    return body && body.service === SERVICE ? body : null;
  } catch {
    // Unreachable, timed out, or answered something that is not our json.
    return null;
  }
}

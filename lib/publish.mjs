// The publish seam: turn a loopback port into a public URL.
//
// Publishing a spec means putting a listener on a loopback port and making that
// port reachable. This module is the second half, and it is the only place that
// knows a tunnel exists. Everything above it deals in `{ url, stop }`.
//
// Only one real implementation exists (cloudflared quick tunnels) plus a fake
// for tests. Quick tunnels draw a fresh hostname on every run, which the design
// accepts: a publication URL is sent to reviewers when it is created, so it does
// not need to survive a restart.
//
// The hostname comes from cloudflared's --metrics server rather than its startup
// banner, because the banner's layout is not a contract and the metrics endpoint
// is documented.

import { spawn as nodeSpawn } from 'node:child_process';
import { createServer } from 'node:net';

export const QUICKTUNNEL_PATH = '/quicktunnel';
export const HOSTNAME_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 400;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the OS for a free loopback port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Poll cloudflared's metrics server until it reports the hostname it was given.
 *
 * The endpoint is absent while cloudflared boots and answers 200 with no
 * hostname for a moment after that, so every not-yet answer is a retry and only
 * the clock ends the loop.
 *
 * `sleepImpl` must yield a macrotask. One that resolves immediately turns this
 * into a hot microtask loop that starves the event loop, so nothing else runs
 * and the only outcome left is the timeout.
 *
 * @param {string} metricsBase e.g. http://127.0.0.1:9999
 * @returns {Promise<string>} the bare hostname
 */
export async function readQuickTunnelHostname(metricsBase, opts = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
    nowImpl = Date.now,
    timeoutMs = HOSTNAME_TIMEOUT_MS,
    signal,
  } = opts;

  const started = nowImpl();
  for (;;) {
    // Checked before the request and again after the wait: an abandoned poll
    // that later rejects would be an unhandled rejection with nothing left to
    // catch it.
    if (signal && signal.aborted) throw new Error('tunnel hostname lookup aborted');
    try {
      const res = await fetchImpl(`${metricsBase}${QUICKTUNNEL_PATH}`);
      if (res.ok) {
        const body = await res.json();
        const hostname = body && (body.hostname || body.Hostname);
        if (hostname) return String(hostname);
      }
    } catch {
      // Metrics server not listening yet.
    }
    if (signal && signal.aborted) throw new Error('tunnel hostname lookup aborted');
    if (nowImpl() - started >= timeoutMs) {
      throw new Error(
        `cloudflared did not report a tunnel hostname within ${timeoutMs} ms ` +
        `(polled ${metricsBase}${QUICKTUNNEL_PATH})`,
      );
    }
    await sleepImpl(POLL_INTERVAL_MS);
  }
}

/**
 * Publish a loopback port through a cloudflared quick tunnel.
 *
 * @param {number} port the loopback port to expose
 * @returns {Promise<{url:string, stop:() => Promise<void>}>}
 */
export async function publishViaCloudflared(port, opts = {}) {
  const {
    spawnImpl = nodeSpawn,
    freePortImpl = freePort,
    ...readOpts
  } = opts;

  const metricsPort = await freePortImpl();
  const child = spawnImpl('cloudflared', [
    'tunnel',
    '--url', `http://127.0.0.1:${port}`,
    '--metrics', `127.0.0.1:${metricsPort}`,
    '--no-autoupdate',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const stop = async () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };

  // A publish that fails must not leave a tunnel running: an unreaped child is a
  // public endpoint with nothing tracking it.
  const abort = new AbortController();
  const died = new Promise((_, reject) => {
    child.once('error', (e) => {
      abort.abort();
      reject(e && e.code === 'ENOENT'
        ? new Error('cloudflared is not installed or not on PATH. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
        : new Error(`cloudflared failed to start: ${e && e.message}`));
    });
    child.once('exit', (code, signal) => {
      abort.abort();
      reject(new Error(`cloudflared exited before publishing (code=${code}, signal=${signal})`));
    });
  });

  // Whichever of these settles first, the other must not be left running: a
  // losing poll that rejects later has no catch and would take the daemon down.
  const poll = readQuickTunnelHostname(`http://127.0.0.1:${metricsPort}`, {
    ...readOpts,
    signal: abort.signal,
  });
  poll.catch(() => {});
  died.catch(() => {});

  let hostname;
  try {
    hostname = await Promise.race([poll, died]);
  } catch (e) {
    abort.abort();
    await stop();
    throw e;
  }

  return { url: `https://${hostname}`, stop };
}

/**
 * Publish nothing and hand back the loopback URL.
 *
 * Lets every layer above this one be tested without a network or a cloudflared
 * binary, which is what keeps the tunnel out of the rest of the test suite.
 */
export async function publishFake(port) {
  return { url: `http://127.0.0.1:${port}`, stop: async () => {} };
}

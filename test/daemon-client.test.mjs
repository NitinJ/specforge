import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer } from 'node:http';

import { ensureDaemon, reusable, specUrl } from '../lib/daemon-client.mjs';
import { readServerState, writeServerState } from '../lib/daemon-state.mjs';

// A definitely-dead pid: exceeds Linux pid_max, so process.kill(_, 0) → ESRCH.
const DEAD_PID = 2147483647;

/** Stand up a throwaway HTTP server answering /healthz → 200. */
function healthzServer() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.writeHead(req.url === '/healthz' ? 200 : 404).end();
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({ srv, port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

/** A port nothing listens on (open then immediately close to free it). */
function deadPort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-dclient-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  // Kill the detached daemon this test spawned (its server.json lives in `home`).
  const s = readServerState();
  if (s && s.pid && s.pid !== process.pid) {
    try { process.kill(s.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('ensureDaemon spawns a detached daemon that serves /healthz, then reuses it', async () => {
  const first = await ensureDaemon({ timeoutMs: 12000 });
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const res = await fetch(new URL('/healthz', first.url));
  assert.equal(res.status, 200);

  // A second call must reuse the same daemon (same port), not spawn another.
  const second = await ensureDaemon({ timeoutMs: 12000 });
  assert.equal(second.port, first.port);

  // The index renders.
  const index = await fetch(first.url);
  assert.equal(index.status, 200);
});

test('reusable trusts the health endpoint, not the recorded pid (dead pid, live daemon)', async () => {
  // A healthy daemon whose server.json still names a dead pid (unclean prior exit
  // + pid reuse). Reuse must follow /healthz, not process.kill(pid, 0).
  const { srv, port, url } = await healthzServer();
  try {
    writeServerState({ port, pid: DEAD_PID, url });
    const r = await reusable();
    assert.deepEqual(r, { url, port });
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test('reusable rejects an unreachable url even when the recorded pid is alive', async () => {
  // isAlive would say "yes" (it is our own pid) but nothing answers /healthz.
  const port = await deadPort();
  writeServerState({ port, pid: process.pid, url: `http://127.0.0.1:${port}/` });
  const r = await reusable();
  assert.equal(r, null);
});

test('specUrl builds the spec route from a base url', () => {
  assert.equal(specUrl('http://127.0.0.1:4180/', 'abc123'), 'http://127.0.0.1:4180/spec/abc123');
});

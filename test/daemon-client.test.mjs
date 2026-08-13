import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer } from 'node:http';

import { ensureDaemon, reusable, specUrl } from '../lib/daemon-client.mjs';
import { daemonAt, daemonUrl, defaultPort } from '../lib/daemon-state.mjs';

/** A port nothing listens on (open then immediately close to free it). */
function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** Stand up a throwaway server on `port` answering /healthz with `body`. */
function fakeDaemon(port, body) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.url !== '/healthz') return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

let home;
let prevHome;
let prevPort;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'sf-dclient-'));
  prevHome = process.env.SPECFORGE_HOME;
  prevPort = process.env.SPECFORGE_PORT;
  process.env.SPECFORGE_HOME = home;
  // Never the real 4180: these tests spawn actual daemons, and one landing on
  // the default port would serve this throwaway store to every open browser tab.
  process.env.SPECFORGE_PORT = String(await freePort());
});

afterEach(async () => {
  // Kill the detached daemon this test spawned. Asking the port who it is works
  // however the process was started, which is the point of the marker.
  const info = await daemonAt(daemonUrl());
  if (info && info.pid !== process.pid) {
    try { process.kill(info.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  if (prevPort === undefined) delete process.env.SPECFORGE_PORT;
  else process.env.SPECFORGE_PORT = prevPort;
  rmSync(home, { recursive: true, force: true });
});

test('ensureDaemon spawns a detached daemon that serves /healthz, then reuses it', async () => {
  const first = await ensureDaemon({ timeoutMs: 12000 });
  assert.equal(first.port, defaultPort(), 'binds the port it was asked for');

  const res = await fetch(new URL('/healthz', first.url));
  assert.equal(res.status, 200);

  // A second call must reuse the same daemon, not spawn another.
  const second = await ensureDaemon({ timeoutMs: 12000 });
  assert.equal(second.port, first.port);

  // The index renders.
  const index = await fetch(first.url);
  assert.equal(index.status, 200);
});

test('reusable finds a daemon by asking the port, with no record to consult', async () => {
  const srv = await fakeDaemon(defaultPort(), JSON.stringify({ service: 'specforge', pid: 4242 }));
  try {
    assert.deepEqual(await reusable(), { url: daemonUrl(), port: defaultPort() });
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('reusable returns null when nothing answers on the port', async () => {
  assert.equal(await reusable(), null);
});

// The marker is what makes "something answers on 4180" a safe basis for reuse.
// Without it any dev server on that port would be adopted as the daemon, and
// every spec url handed out would 404 with nothing to explain why.
test('reusable ignores a server on the port that is not SpecForge', async () => {
  const srv = await fakeDaemon(defaultPort(), JSON.stringify({ service: 'vite', pid: 1 }));
  try {
    assert.equal(await reusable(), null);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('specUrl builds the spec route from a base url', () => {
  assert.equal(specUrl('http://127.0.0.1:4180/', 'abc123'), 'http://127.0.0.1:4180/spec/abc123');
});

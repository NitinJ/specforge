import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureDaemon, specUrl } from '../lib/daemon-client.mjs';
import { readServerState } from '../lib/daemon-state.mjs';

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

test('specUrl builds the spec route from a base url', () => {
  assert.equal(specUrl('http://127.0.0.1:4180/', 'abc123'), 'http://127.0.0.1:4180/spec/abc123');
});

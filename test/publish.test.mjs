// The publish seam: turn a loopback port into a public URL.
//
// Everything here runs without a network and without cloudflared installed —
// the child process and the metrics endpoint are both injected. The one thing
// that needs a real tunnel (does the hostname actually serve?) is Stage 4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  readQuickTunnelHostname,
  publishViaCloudflared,
  publishFake,
  HOSTNAME_TIMEOUT_MS,
} from '../lib/publish.mjs';

/** A fetch stand-in driven by a queue of [status, body] or Error. */
function fetchStub(steps) {
  let i = 0;
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    const [status, body] = step;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

/** A child-process stand-in that records argv and kill signals. */
function spawnStub() {
  const child = new EventEmitter();
  child.killed = false;
  child.signals = [];
  child.kill = (sig) => { child.killed = true; child.signals.push(sig); return true; };
  const fn = (cmd, args) => { fn.cmd = cmd; fn.args = args; return child; };
  fn.child = child;
  return fn;
}

// Yields a macrotask rather than resolving immediately. An `async () => {}`
// sleep makes the poll a hot microtask loop that starves the event loop, so
// nothing else in the test ever runs and the poll reaches its timeout.
const noSleep = () => new Promise((r) => setImmediate(r));

// publishViaCloudflared awaits a free port before it spawns, so a stub that
// emits synchronously fires before any listener exists. Yield first.
const tick = () => new Promise((r) => setImmediate(r));

test('reads the hostname the metrics server reports', async () => {
  const host = 'calm-fox-1234.trycloudflare.com';
  const got = await readQuickTunnelHostname('http://127.0.0.1:9', {
    fetchImpl: fetchStub([[200, { hostname: host }]]),
    sleepImpl: noSleep,
  });
  assert.equal(got, host);
});

test('polls past the window where the metrics server is not up yet', async () => {
  const host = 'calm-fox-1234.trycloudflare.com';
  const f = fetchStub([
    new Error('ECONNREFUSED'),
    [404, {}],
    [200, {}],                    // up, but no hostname assigned yet
    [200, { hostname: host }],
  ]);
  const got = await readQuickTunnelHostname('http://127.0.0.1:9', { fetchImpl: f, sleepImpl: noSleep });
  assert.equal(got, host);
  assert.equal(f.calls.length, 4);
  assert.match(f.calls[0], /\/quicktunnel$/);
});

test('gives up with an actionable message rather than hanging', async () => {
  let clock = 0;
  await assert.rejects(
    () => readQuickTunnelHostname('http://127.0.0.1:9', {
      fetchImpl: fetchStub([[200, {}]]),
      sleepImpl: async (ms) => { clock += ms; },
      nowImpl: () => clock,
    }),
    /hostname/i,
  );
  assert.ok(clock >= HOSTNAME_TIMEOUT_MS, 'waited the full budget before failing');
});

test('spawns cloudflared pointed at the loopback port', async () => {
  const spawnImpl = spawnStub();
  const { url } = await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  assert.equal(spawnImpl.cmd, 'cloudflared');
  assert.deepEqual(spawnImpl.args, [
    'tunnel',
    '--url', 'http://127.0.0.1:4321',
    '--metrics', '127.0.0.1:9999',
    '--no-autoupdate',
  ]);
  assert.equal(url, 'https://h.trycloudflare.com');
});

test('stop() kills the child', async () => {
  const spawnImpl = spawnStub();
  const { stop } = await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  await stop();
  assert.equal(spawnImpl.child.killed, true);
  assert.deepEqual(spawnImpl.child.signals, ['SIGTERM']);
});

// A tunnel process that outlives a failed publish is a public endpoint nobody
// is tracking, so the failure path has to reap it.
test('kills the child when the hostname never arrives', async () => {
  const spawnImpl = spawnStub();
  let clock = 0;
  await assert.rejects(() => publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, {}]]),
    sleepImpl: async (ms) => { clock += ms; },
    nowImpl: () => clock,
    freePortImpl: async () => 9999,
  }));
  assert.equal(spawnImpl.child.killed, true, 'no orphaned tunnel');
});

test('a missing cloudflared binary fails with an install hint', async () => {
  const spawnImpl = spawnStub();
  const p = publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, {}]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  await tick();
  const err = Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' });
  spawnImpl.child.emit('error', err);
  await assert.rejects(() => p, /not installed|cloudflared/i);
});

// The child dying mid-publish must surface, not stall until the timeout.
test('a child that exits early fails fast', async () => {
  const spawnImpl = spawnStub();
  const p = publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, {}]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  await tick();
  spawnImpl.child.emit('exit', 1, null);
  await assert.rejects(() => p, /exited/i);
});

test('the fake publishes to loopback and stops cleanly', async () => {
  const { url, stop } = await publishFake(4321);
  assert.equal(url, 'http://127.0.0.1:4321');
  await stop();
});

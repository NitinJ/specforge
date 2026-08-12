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

/**
 * A child-process stand-in that records argv and kill signals.
 * @param {{ignoreSigterm?:boolean}} opts ignoreSigterm models a wedged process
 *   that has to be escalated to SIGKILL.
 */
function spawnStub(opts = {}) {
  const child = new EventEmitter();
  child.killed = false;
  child.signals = [];
  child.pid = 24680;
  child.unrefCalls = 0;
  child.unref = () => { child.unrefCalls += 1; };
  child.kill = (sig) => {
    child.killed = true;
    child.signals.push(sig);
    // A real child exits on SIGTERM; emit it so stop() can observe the exit it
    // is contractually waiting for.
    if (sig === 'SIGKILL' || (sig === 'SIGTERM' && !opts.ignoreSigterm)) {
      setImmediate(() => child.emit('exit', 0, sig));
    }
    return true;
  };
  const fn = (cmd, args, spawnOpts) => {
    fn.cmd = cmd; fn.args = args; fn.opts = spawnOpts || {};
    return child;
  };
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

// The whole point of stage 2: the daemon restarts often, and a tunnel that is
// a child of the daemon's process group goes down with it, taking every URL
// already sent. Detaching is what lets the next daemon adopt it.
test('the tunnel is detached so it survives the daemon', async () => {
  const spawnImpl = spawnStub();
  await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  assert.equal(spawnImpl.opts.detached, true, 'not in the daemon process group');
  assert.deepEqual(spawnImpl.opts.stdio, ['ignore', 'ignore', 'ignore'],
    'no pipe back to a parent that will not be there');
  assert.equal(spawnImpl.child.unrefCalls, 1, 'and it does not hold the event loop open');
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

// The budget was checked only between requests, so a metrics endpoint that
// accepts a connection and never answers held the loop open past its own
// timeout and past cancellation.
test('a metrics request that never answers cannot outlive the budget', async () => {
  let clock = 0;
  const hung = () => new Promise(() => {});   // never settles, ignores signals
  await assert.rejects(
    () => readQuickTunnelHostname('http://127.0.0.1:9', {
      fetchImpl: hung,
      sleepImpl: noSleep,
      nowImpl: () => clock,
      requestTimeoutMs: 20,
      // Each attempt burns a slice of the budget, so the loop ends on the clock
      // rather than running forever.
      onAttempt: () => { clock += 10000; },
    }),
    /within 30000 ms/,
  );
});

// A real response body is unreadable once its request is aborted. A stub whose
// json() ignores the signal hides that, and hid it here: every poll succeeded
// in tests and every poll failed against cloudflared.
test('the body is read before the request is released', async () => {
  const realistic = async (_url, init) => ({
    ok: true,
    status: 200,
    json: async () => {
      if (init.signal.aborted) throw new Error('The operation was aborted');
      return { hostname: 'h.trycloudflare.com' };
    },
  });
  const got = await readQuickTunnelHostname('http://127.0.0.1:9', {
    fetchImpl: realistic,
    sleepImpl: noSleep,
    requestTimeoutMs: 500,
  });
  assert.equal(got, 'h.trycloudflare.com');
});

test('a hung request is abandoned rather than accumulated', async () => {
  let live = 0;
  const hung = (_url, init) => new Promise((_, reject) => {
    live++;
    // A well-behaved fetch rejects when its signal aborts.
    init.signal.addEventListener('abort', () => { live--; reject(new Error('aborted')); }, { once: true });
  });
  let clock = 0;
  await assert.rejects(() => readQuickTunnelHostname('http://127.0.0.1:9', {
    fetchImpl: hung,
    sleepImpl: noSleep,
    nowImpl: () => clock,
    requestTimeoutMs: 20,
    onAttempt: () => { clock += 10000; },
  }));
  assert.equal(live, 0, 'every abandoned request was aborted');
});

// stop() resolving on the signal rather than the exit lets a caller drop the
// publication record while the public endpoint is still serving.
test('stop() waits for the child to actually exit', async () => {
  const spawnImpl = spawnStub();
  const { stop } = await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  let exited = false;
  spawnImpl.child.once('exit', () => { exited = true; });
  await stop();
  assert.equal(exited, true, 'stop resolved only after the exit event');
});

test('stop() escalates to SIGKILL when SIGTERM is ignored', async () => {
  const spawnImpl = spawnStub({ ignoreSigterm: true });
  const { stop } = await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
    killTimeoutMs: 30,
  });
  await stop();
  assert.deepEqual(spawnImpl.child.signals, ['SIGTERM', 'SIGKILL']);
});

test('stop() is idempotent', async () => {
  const spawnImpl = spawnStub();
  const { stop } = await publishViaCloudflared(4321, {
    spawnImpl,
    fetchImpl: fetchStub([[200, { hostname: 'h.trycloudflare.com' }]]),
    sleepImpl: noSleep,
    freePortImpl: async () => 9999,
  });
  await stop();
  await stop();
  assert.deepEqual(spawnImpl.child.signals, ['SIGTERM'], 'the second stop signalled nothing');
});

test('the fake publishes to loopback and stops cleanly', async () => {
  const { url, stop } = await publishFake(4321);
  assert.equal(url, 'http://127.0.0.1:4321');
  await stop();
});

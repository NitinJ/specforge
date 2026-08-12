// Publication lifecycle: share, unshare, and what survives a daemon restart.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-pubs-'));
process.env.SPECFORGE_HOME = home;

const { createPublications } = await import('../lib/publications.mjs');
const { specDir, specHtmlPath, sharePath } = await import('../lib/store-paths.mjs');
const { readShare } = await import('../lib/store-share.mjs');

function seed(id) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${id}</title></head><body><p>${id}</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: id, status: 'draft' }));
}

/** A publish seam that records calls and never spawns anything. */
function fakePublisher() {
  const calls = [];
  const stopped = [];
  const fn = async (port) => {
    calls.push(port);
    return {
      url: `https://fake-${port}.example`,
      pid: 4242,
      stop: async () => { stopped.push(port); },
    };
  };
  fn.calls = calls;
  fn.stopped = stopped;
  return fn;
}

/**
 * A registry with every seam injected and nothing real behind it.
 *
 * `aliveImpl`, `probeImpl` and `port` are forwarded but not yet read by
 * createPublications. They are passed from here so a test written now keeps
 * working unchanged once the gateway and adopt-on-start start reading them.
 *
 * @param {object} [overrides] wins over every default, including killImpl (in
 *   which case the returned `killed` array stays empty).
 * @returns {{pubs:object, publish:Function, killed:number[], deps:object}}
 */
function mkPubs(overrides = {}) {
  const killed = [];
  const deps = {
    publishImpl: fakePublisher(),
    killImpl: (pid) => killed.push(pid),
    aliveImpl: () => true,
    probeImpl: async () => true,
    port: 0, // tests never bind the production port
    ...overrides,
  };
  const pubs = createPublications(deps);
  registries.push(pubs);
  return { pubs, publish: deps.publishImpl, killed, deps };
}

/**
 * What a SIGKILLed daemon leaves behind: the registry object is gone, its
 * records on disk and any tunnel processes it spawned are not.
 *
 * Deliberately does not call stopAll, because a daemon that was killed outright
 * did not either, and adopt-on-start exists for exactly that case. The seams are
 * carried over, so a fake publisher's call count spans the restart and a test
 * can assert that no second tunnel was started.
 */
function restart(prev, overrides = {}) {
  return mkPubs({ ...prev.deps, ...overrides });
}

let pubs;
let publishImpl;
const registries = [];

before(() => {
  seed('alpha');
  seed('beta');
});

after(async () => {
  if (pubs) await pubs.stopAll();
  await Promise.allSettled(registries.map((r) => r.stopAll()));
  rmSync(home, { recursive: true, force: true });
});

test('sharing returns a URL and records it', async () => {
  publishImpl = fakePublisher();
  pubs = createPublications({ publishImpl });
  const rec = await pubs.share('alpha');
  assert.match(rec.url, /^https:\/\/fake-\d+\.example$/);
  assert.equal(rec.specId, 'alpha');
  assert.ok(rec.port > 0);
  assert.deepEqual(readShare('alpha'), rec, 'the record is on disk');
});

test('the published listener actually answers on its port', async () => {
  const rec = readShare('alpha');
  const r = await fetch(`http://127.0.0.1:${rec.port}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /alpha/);
});

test('sharing twice returns the same publication, not a second tunnel', async () => {
  const again = await pubs.share('alpha');
  assert.equal(again.url, readShare('alpha').url);
  assert.equal(publishImpl.calls.length, 1, 'only one tunnel was ever started');
});

// share() awaits a port and a tunnel before it can record anything, so two
// overlapping calls would both pass the "already live?" check. The loser's
// tunnel would then be public with nothing tracking it and no way to stop it.
test('overlapping shares start one tunnel, not two', async () => {
  seed('zeta');
  const publish = fakePublisher();
  const p = createPublications({ publishImpl: publish });
  const [a, b, c] = await Promise.all([p.share('zeta'), p.share('zeta'), p.share('zeta')]);
  assert.equal(publish.calls.length, 1, 'only one tunnel was started');
  assert.equal(a.url, b.url);
  assert.equal(b.url, c.url);
  assert.equal(p.list().length, 1);
  await p.stopAll();
});

// Registry membership is not proof the link works. cloudflared can die on its
// own, and a badge that reads "Shared" over a dead tunnel is worse than none.
test('a publication whose tunnel died is not reported as live', async () => {
  seed('rho');
  let up = true;
  const publish = async (port) => ({
    url: `https://r-${port}.example`, pid: 9, stop: async () => { up = false; }, alive: () => up,
  });
  const p = createPublications({ publishImpl: publish });
  await p.share('rho');
  assert.equal(p.isLive('rho'), true, 'live while the tunnel is up');
  up = false; // cloudflared exits on its own
  assert.equal(p.isLive('rho'), false, 'and not once it is gone');
  assert.ok(readShare('rho'), 'the record is still there, which is why asking the tunnel matters');
  await p.stopAll();
});

// The action offered when a link is down is "share again", so that call has to
// replace a dead publication rather than hand its URL back.
test('sharing again replaces a publication whose tunnel died', async () => {
  seed('upsilon');
  let n = 0;
  const alive = [];
  const publish = async (port) => {
    const i = n++;
    alive[i] = true;
    return {
      url: `https://gen${i}-${port}.example`, pid: 100 + i,
      stop: async () => { alive[i] = false; }, alive: () => alive[i],
    };
  };
  const p = createPublications({ publishImpl: publish });
  const first = await p.share('upsilon');
  alive[0] = false; // the tunnel dies on its own
  assert.equal(p.isLive('upsilon'), false);

  const second = await p.share('upsilon');
  assert.notEqual(second.url, first.url, 'a new link, not the dead one');
  assert.equal(p.isLive('upsilon'), true, 'and it works');
  assert.equal(readShare('upsilon').url, second.url, 'the record names the new one');
  await p.stopAll();
});

test('sharing a healthy publication still returns the same link', async () => {
  seed('phi');
  const { pubs: p, publish } = mkPubs();
  const a = await p.share('phi');
  const b = await p.share('phi');
  assert.equal(a.url, b.url);
  assert.equal(publish.calls.length, 1, 'and starts no second tunnel');
  await p.stopAll();
});

test('an unpublished spec is not live', async () => {
  seed('sigma');
  const { pubs: p } = mkPubs();
  assert.equal(p.isLive('sigma'), false);
});

// Regenerating a dead link is exactly when an orphan tunnel is still running.
test('publishing over a stale record reaps the tunnel it named', async () => {
  seed('tau');
  const { pubs: p, killed } = mkPubs();
  writeFileSync(sharePath('tau'), JSON.stringify({
    specId: 'tau', url: 'https://dead.example', port: 1, pid: 4321, createdAt: 'then',
  }));
  await p.share('tau');
  assert.deepEqual(killed, [4321], 'the tunnel behind the dead link was stopped first');
  await p.stopAll();
});

// The fixture's own contract. A restart must leave behind exactly what a killed
// daemon leaves behind, or every adopt-on-start test built on it is testing a
// situation that cannot occur.
test('restart keeps the records and does not stop the tunnels', async () => {
  seed('omega');
  const first = mkPubs();
  const rec = await first.pubs.share('omega');
  assert.equal(first.publish.calls.length, 1);

  const second = restart(first);
  assert.deepEqual(readShare('omega'), rec, 'the record survives');
  assert.equal(second.publish.stopped.length, 0, 'no tunnel was stopped on the way down');
  assert.equal(second.publish.calls.length, 1, 'and the call count carries over');
  assert.equal(second.pubs.list().length, 0, 'the new registry starts empty, as a new process would');
});

test('a failed share does not poison the next attempt', async () => {
  seed('eta');
  let attempt = 0;
  const flaky = async (port) => {
    if (++attempt === 1) throw new Error('cloudflared exited before publishing');
    return { url: `https://ok-${port}.example`, pid: 1, stop: async () => {} };
  };
  const p = createPublications({ publishImpl: flaky });
  await assert.rejects(() => p.share('eta'), /exited/);
  const rec = await p.share('eta');
  assert.match(rec.url, /^https:\/\/ok-/, 'the retry publishes');
  await p.stopAll();
});

// A share that has not finished starting is in neither `live` nor the store, so
// a revoke or a shutdown that only sweeps `live` misses it — and it publishes
// itself moments later, having outlived the thing meant to stop it.
test('revoking a share that is still starting still stops it', async () => {
  seed('iota');
  let release;
  const held = new Promise((r) => { release = r; });
  const stopped = [];
  const slow = async (port) => {
    await held; // the tunnel is still coming up
    return { url: `https://slow-${port}.example`, pid: 3, stop: async () => stopped.push(port) };
  };
  const p = createPublications({ publishImpl: slow });
  const sharing = p.share('iota');
  const revoking = p.unshare('iota');   // arrives before the tunnel is up
  release();
  const rec = await sharing;
  await revoking;
  assert.ok(stopped.includes(rec.port), 'the tunnel that landed late was stopped');
  assert.equal(readShare('iota'), null, 'and left no record');
  assert.equal(p.list().length, 0);
});

test('shutdown stops a share that is still starting', async () => {
  seed('kappa');
  let release;
  const held = new Promise((r) => { release = r; });
  const stopped = [];
  const slow = async (port) => {
    await held;
    return { url: `https://slow-${port}.example`, pid: 4, stop: async () => stopped.push(port) };
  };
  const p = createPublications({ publishImpl: slow });
  const sharing = p.share('kappa');
  const stopping = p.stopAll();
  release();
  // The tunnel comes up into a shutting-down daemon, so it refuses to publish
  // and takes itself back down rather than landing to be swept.
  await assert.rejects(() => sharing, /shutting down/);
  await stopping;
  assert.equal(stopped.length, 1, 'the tunnel that came up was stopped');
  assert.equal(p.list().length, 0);
  assert.equal(readShare('kappa'), null);
});

// A tunnel takes seconds to come up, and the spec can be deleted in that
// window. Publishing it afterwards would serve a spec that no longer exists,
// and writeShare would recreate the directory the delete had just removed.
test('a share whose spec is deleted mid-startup publishes nothing', async () => {
  seed('mu');
  let release;
  const held = new Promise((r) => { release = r; });
  const stopped = [];
  const slow = async (port) => {
    await held;
    return { url: `https://slow-${port}.example`, pid: 5, stop: async () => stopped.push(port) };
  };
  const p = createPublications({ publishImpl: slow });
  const sharing = p.share('mu');
  rmSync(specDir('mu'), { recursive: true, force: true }); // deleted while the tunnel comes up
  release();
  await assert.rejects(() => sharing, /unknown spec/);
  assert.equal(stopped.length, 1, 'the tunnel that came up was taken down again');
  assert.equal(existsSync(specDir('mu')), false, 'and the deleted spec was not resurrected');
  assert.equal(p.list().length, 0);
});

// Checking that the spec exists, even at the commit point, still leaves the
// window between the revoke and the directory being removed. The delete holds
// the door for its whole duration instead.
test('a share cannot commit anywhere inside a delete', async () => {
  seed('nu');
  const publish = fakePublisher();
  const p = createPublications({ publishImpl: publish });
  let refused = null;
  await p.unshareThen('nu', async () => {
    // Mid-delete: the spec still exists on disk, so an existence check would
    // pass. The share must be refused anyway.
    refused = await p.share('nu').then(() => null, (e) => e.message);
    rmSync(specDir('nu'), { recursive: true, force: true });
  });
  assert.match(refused, /being deleted/);
  assert.equal(publish.calls.length, 0, 'no tunnel was started');
  assert.equal(p.list().length, 0);
  assert.equal(existsSync(specDir('nu')), false, 'the delete stands');
});

test('sharing works again once a delete finishes', async () => {
  seed('xi');
  const p = createPublications({ publishImpl: fakePublisher() });
  await p.unshareThen('xi', async () => {});
  const rec = await p.share('xi');
  assert.ok(rec.url, 'the door reopens');
  await p.stopAll();
});

test('a share arriving after shutdown is refused rather than leaked', async () => {
  seed('lambda');
  const p = createPublications({ publishImpl: fakePublisher() });
  await p.stopAll();
  await assert.rejects(() => p.share('lambda'), /shutting down/);
  assert.equal(readShare('lambda'), null);
});

// The record is the only route back to a tunnel whose daemon is gone, so it
// must outlive the tunnel rather than the other way round.
test('unshare drops the record only after the tunnel is confirmed stopped', async () => {
  seed('theta');
  const order = [];
  const publish = async (port) => ({
    url: `https://t-${port}.example`,
    pid: 7,
    stop: async () => {
      order.push('tunnel stopped');
      // The record must still be readable here: if the process died at this
      // moment, the pid is the only way a later daemon could reap the tunnel.
      order.push(readShare('theta') ? 'record still present' : 'record already gone');
    },
  });
  const p = createPublications({ publishImpl: publish });
  await p.share('theta');
  await p.unshare('theta');
  assert.deepEqual(order, ['tunnel stopped', 'record still present']);
  assert.equal(readShare('theta'), null, 'and it is gone once the tunnel is');
});

test('two specs get two independent publications', async () => {
  const b = await pubs.share('beta');
  assert.notEqual(b.port, readShare('alpha').port);
  assert.equal(publishImpl.calls.length, 2);
  assert.equal(pubs.list().length, 2);
});

test('unsharing stops the tunnel, closes the socket and drops the record', async () => {
  const { port } = readShare('beta');
  await pubs.unshare('beta');
  assert.equal(readShare('beta'), null);
  assert.equal(existsSync(sharePath('beta')), false);
  assert.ok(publishImpl.stopped.includes(port), 'the tunnel was stopped');
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`), 'the socket is closed');
});

test('unsharing something unpublished is not an error', async () => {
  assert.equal(await pubs.unshare('beta'), false);
});

test('sharing an unknown spec fails rather than publishing nothing', async () => {
  await assert.rejects(() => pubs.share('nosuchspec'), /unknown spec/i);
});

// A publish that fails must not leave a listening socket behind.
test('a failed tunnel leaves no listener and no record', async () => {
  const boom = async () => { throw new Error('cloudflared is not installed'); };
  const p = createPublications({ publishImpl: boom });
  await assert.rejects(() => p.share('beta'), /not installed/);
  assert.equal(readShare('beta'), null);
  assert.equal(p.list().length, 0);
});

// Records outlive the daemon; the processes they name do not. A cloudflared
// child survives a SIGKILLed parent, so the record is the only way back to it.
test('stale records are cleared at startup and their tunnels reaped', async () => {
  seed('gamma');
  writeFileSync(sharePath('gamma'), JSON.stringify({
    specId: 'gamma', url: 'https://gone.example', port: 1, pid: 999999, createdAt: 'then',
  }));
  const killed = [];
  const p = createPublications({ publishImpl: fakePublisher(), killImpl: (pid) => killed.push(pid) });
  p.clearStale();
  assert.equal(readShare('gamma'), null, 'the record is gone');
  assert.ok(killed.includes(999999), 'the tunnel it named was reaped');
});

test('clearStale tolerates a process that is already gone', () => {
  seed('delta');
  writeFileSync(sharePath('delta'), JSON.stringify({
    specId: 'delta', url: 'https://gone.example', port: 1, pid: 999998, createdAt: 'then',
  }));
  const p = createPublications({
    publishImpl: fakePublisher(),
    killImpl: () => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); },
  });
  p.clearStale();
  assert.equal(readShare('delta'), null);
});

// Startup reaping must not touch a publication this daemon is already serving.
test('clearStale leaves this instance\'s own publications alone', async () => {
  seed('epsilon');
  const p = createPublications({ publishImpl: fakePublisher(), killImpl: () => {} });
  const rec = await p.share('epsilon');
  p.clearStale();
  assert.deepEqual(readShare('epsilon'), rec, 'still published');
  assert.equal(p.list().length, 1);
  await p.stopAll();
});

test('stopAll takes everything down', async () => {
  await pubs.stopAll();
  assert.equal(pubs.list().length, 0);
  assert.equal(readShare('alpha'), null);
});

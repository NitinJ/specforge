// Publication lifecycle: what is published, on what origin, and what survives a
// daemon restart.
//
// One gateway serves every published spec and one tunnel exposes the gateway, so
// the tests here fall into two groups: the addressing model (tokens, one origin,
// revocation) and the lifecycle races that predate it and still have to hold.

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
 * `aliveImpl` and `probeImpl` are forwarded but not read until adopt-on-start
 * lands, so a test written against them now keeps working unchanged then.
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
 * can assert that adopting started no second tunnel.
 */
function restart(prev, overrides = {}) {
  return mkPubs({ ...prev.deps, ...overrides });
}

const registries = [];

/**
 * Run `fn` against a store of its own.
 *
 * restore() reads every spec directory in the store, so a test that asserts on
 * what it restored cannot share a home with the tests that ran before it.
 * storeRoot() reads the env var per call, so swapping it is enough.
 */
async function withHome(fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'sf-pubs-home-'));
  const previous = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = scratch;
  try {
    return await fn();
  } finally {
    process.env.SPECFORGE_HOME = previous;
    rmSync(scratch, { recursive: true, force: true });
  }
}

before(() => {
  seed('alpha');
  seed('beta');
});

after(async () => {
  await Promise.allSettled(registries.map((r) => r.stopAll()));
  rmSync(home, { recursive: true, force: true });
});

// ---- addressing: one origin, one token per spec ----

test('sharing returns a token-addressed URL and records the token', async () => {
  const { pubs: p } = mkPubs();
  const rec = await p.share('alpha');
  assert.equal(rec.specId, 'alpha');
  assert.match(rec.token, /^[0-9a-f]{32}$/);
  assert.equal(rec.url, `${p.origin()}/s/${rec.token}`);
  assert.equal(readShare('alpha').token, rec.token, 'the token is on disk');
  await p.stopAll();
});

// A record must not pin an origin, because the origin can change under it and
// then every record would need rewriting to stay true.
test('the record holds the token and nothing about the tunnel', async () => {
  seed('g-disk');
  const { pubs: p } = mkPubs();
  await p.share('g-disk');
  const onDisk = readShare('g-disk');
  assert.deepEqual(Object.keys(onDisk).sort(), ['createdAt', 'specId', 'token']);
  await p.stopAll();
});

// The whole point of the rework: N specs must not mean N tunnels, because a
// stable origin cannot be built out of one hostname per spec.
test('two published specs share one tunnel and one origin', async () => {
  seed('g-one'); seed('g-two');
  const { pubs: p, publish } = mkPubs();
  const a = await p.share('g-one');
  const b = await p.share('g-two');
  assert.equal(publish.calls.length, 1, 'one tunnel for both');
  assert.equal(new URL(a.url).origin, new URL(b.url).origin, 'and one origin');
  assert.notEqual(a.token, b.token);
  await p.stopAll();
});

test('the tunnel starts on the first publish, not before', async () => {
  seed('g-lazy');
  const { pubs: p, publish } = mkPubs();
  assert.equal(publish.calls.length, 0, 'nothing published, nothing exposed');
  assert.equal(p.origin(), null);
  await p.share('g-lazy');
  assert.equal(publish.calls.length, 1);
  await p.stopAll();
});

// D4: "nothing published" and "nothing exposed" must be the same state.
test('the tunnel stops on the last unpublish and returns for the next publish', async () => {
  seed('g-a'); seed('g-b');
  const { pubs: p, publish } = mkPubs();
  await p.share('g-a');
  await p.share('g-b');
  await p.unshare('g-a');
  assert.equal(publish.stopped.length, 0, 'one spec left, so the tunnel stays');
  await p.unshare('g-b');
  assert.equal(publish.stopped.length, 1, 'nothing published, so nothing exposed');
  assert.equal(p.origin(), null);

  await p.share('g-a');
  assert.equal(publish.calls.length, 2, 'and it comes back for the next publish');
  await p.stopAll();
});

test('unpublishing one spec leaves the other reachable', async () => {
  seed('g-keep'); seed('g-drop');
  const { pubs: p } = mkPubs();
  const keep = await p.share('g-keep');
  const drop = await p.share('g-drop');
  await p.unshare('g-drop');
  assert.equal(p.resolve(keep.token), 'g-keep', 'still published');
  assert.equal(p.resolve(drop.token), null, 'revoked immediately');
  assert.ok(readShare('g-keep'));
  assert.equal(readShare('g-drop'), null);
  await p.stopAll();
});

// D2: republishing is what someone does after losing the link, so it must not
// invalidate the copies already sent.
test('republishing returns the same token', async () => {
  seed('g-again');
  const { pubs: p, publish } = mkPubs();
  const first = await p.share('g-again');
  const second = await p.share('g-again');
  assert.equal(second.token, first.token);
  assert.equal(second.url, first.url);
  assert.equal(publish.calls.length, 1);
  await p.stopAll();
});

// D2 keeps a token across a republish, but unpublishing is required to revoke
// (§2), and a token that came back would resurrect every link already sent. So
// the two mechanisms are kept disjoint: share-again is idempotent and keeps the
// token, unshare destroys it, and rotate revokes without unpublishing.
test('unpublishing destroys the token rather than parking it', async () => {
  seed('g-cycle');
  const { pubs: p } = mkPubs();
  const first = await p.share('g-cycle');
  await p.unshare('g-cycle');
  const second = await p.share('g-cycle');
  assert.notEqual(second.token, first.token, 'the revoked link does not come back');
  assert.equal(p.resolve(first.token), null);
  await p.stopAll();
});

test('rotating mints a new token and revokes the old one', async () => {
  seed('g-rotate');
  const { pubs: p } = mkPubs();
  const first = await p.share('g-rotate');
  const second = await p.share('g-rotate', { rotate: true });
  assert.notEqual(second.token, first.token);
  assert.equal(p.resolve(first.token), null, 'the old link is dead');
  assert.equal(p.resolve(second.token), 'g-rotate');
  await p.stopAll();
});

test('rotating an unpublished spec publishes it', async () => {
  seed('g-rot-new');
  const { pubs: p } = mkPubs();
  const rec = await p.share('g-rot-new', { rotate: true });
  assert.equal(p.resolve(rec.token), 'g-rot-new');
  await p.stopAll();
});

test('resolve refuses anything that is not a live token', async () => {
  seed('g-res');
  const { pubs: p } = mkPubs();
  await p.share('g-res');
  assert.equal(p.resolve('g-res'), null, 'a spec id is not an address');
  assert.equal(p.resolve(''), null);
  assert.equal(p.resolve(null), null);
  assert.equal(p.resolve('0'.repeat(32)), null, 'a well-formed token nobody minted');
  await p.stopAll();
});

test('the gateway answers on the port the registry bound', async () => {
  seed('g-serve');
  const { pubs: p } = mkPubs();
  const rec = await p.share('g-serve');
  const r = await fetch(`http://127.0.0.1:${p.localPort()}/s/${rec.token}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /g-serve/);
  await p.stopAll();
});

test('the gateway stops answering once the spec is unpublished', async () => {
  seed('g-revoke'); seed('g-other');
  const { pubs: p } = mkPubs();
  const rec = await p.share('g-revoke');
  await p.share('g-other'); // keeps the gateway up after the revoke
  const port = p.localPort();
  assert.equal((await fetch(`http://127.0.0.1:${port}/s/${rec.token}`)).status, 200);
  await p.unshare('g-revoke');
  assert.equal((await fetch(`http://127.0.0.1:${port}/s/${rec.token}`)).status, 404,
    'the link is dead, not stale');
  await p.stopAll();
});

test('list reports one entry per published spec, each on the shared origin', async () => {
  seed('g-l1'); seed('g-l2');
  const { pubs: p } = mkPubs();
  await p.share('g-l1');
  await p.share('g-l2');
  assert.deepEqual(p.list().map((r) => r.specId).sort(), ['g-l1', 'g-l2']);
  assert.ok(p.list().every((r) => r.url.startsWith(p.origin())));
  await p.stopAll();
});

// ---- liveness ----

test('isLive answers for a published spec and denies an unpublished one', async () => {
  seed('g-live'); seed('g-dead');
  const { pubs: p } = mkPubs();
  await p.share('g-live');
  assert.equal(p.isLive('g-live'), true);
  assert.equal(p.isLive('g-dead'), false);
  await p.stopAll();
});

// Registry membership is not proof the link works. cloudflared can exit on its
// own, and a badge reading "Shared" over a dead tunnel is worse than none.
test('a dead tunnel makes every published spec not live', async () => {
  seed('g-t1'); seed('g-t2');
  let up = true;
  const publish = async (port) => ({
    url: `https://t-${port}.example`, pid: 8,
    stop: async () => { up = false; }, alive: () => up,
  });
  const { pubs: p } = mkPubs({ publishImpl: publish });
  await p.share('g-t1');
  await p.share('g-t2');
  assert.equal(p.isLive('g-t1'), true);
  up = false;
  assert.equal(p.isLive('g-t1'), false);
  assert.equal(p.isLive('g-t2'), false);
  await p.stopAll();
});

// The action offered when a link is down is "share again", so that call has to
// replace a dead tunnel rather than hand its origin back.
test('sharing again after the tunnel died brings it back on the same token', async () => {
  seed('g-replace');
  let n = 0;
  const alive = [];
  const publish = async (port) => {
    const i = n++;
    alive[i] = true;
    return {
      url: `https://gen${i}-${port}.example`, pid: 200 + i,
      stop: async () => { alive[i] = false; }, alive: () => alive[i],
    };
  };
  const { pubs: p } = mkPubs({ publishImpl: publish });
  const first = await p.share('g-replace');
  alive[0] = false;
  assert.equal(p.isLive('g-replace'), false);

  const second = await p.share('g-replace');
  assert.equal(second.token, first.token, 'the token is not what broke');
  assert.notEqual(second.url, first.url, 'but the origin is new');
  assert.equal(p.isLive('g-replace'), true);
  await p.stopAll();
});

// ---- restore across a restart ----

test('restore republishes what was published before, on the same tokens', () => withHome(async () => {
  seed('g-restore'); seed('g-quiet');
  const first = mkPubs();
  const rec = await first.pubs.share('g-restore');

  const second = restart(first);
  await second.pubs.restore();
  assert.equal(second.pubs.resolve(rec.token), 'g-restore', 'the link already sent still works');
  assert.deepEqual(second.pubs.list().map((r) => r.specId), ['g-restore'],
    'and a spec that was never published stays unpublished');
  assert.ok(second.pubs.origin(), 'the tunnel is back up');
  await second.pubs.stopAll();
}));

test('restore with nothing published starts no tunnel', () => withHome(async () => {
  seed('g-none');
  const { pubs: p, publish } = mkPubs();
  await p.restore();
  assert.equal(publish.calls.length, 0);
  assert.equal(p.origin(), null);
  assert.equal(p.localPort(), null);
}));

// A record from the scheme that gave each spec its own tunnel names a port that
// died with its daemon, and a cloudflared child that may not have.
test('a legacy share record is reaped, not honoured', () => withHome(async () => {
  seed('g-legacy');
  const { pubs: p, killed } = mkPubs();
  writeFileSync(sharePath('g-legacy'), JSON.stringify({
    specId: 'g-legacy', url: 'https://old.example', port: 5, pid: 31337, createdAt: 'then',
  }));
  await p.restore();
  assert.deepEqual(killed, [31337], 'its tunnel was reaped');
  assert.equal(readShare('g-legacy'), null, 'and the record is gone');
  assert.equal(p.list().length, 0);
  assert.equal(p.origin(), null, 'a legacy record does not count as published');
}));

test('restore tolerates a legacy record whose process is already gone', () => withHome(async () => {
  seed('g-legacy2');
  const { pubs: p } = mkPubs({
    killImpl: () => { throw new Error('ESRCH'); },
  });
  writeFileSync(sharePath('g-legacy2'), JSON.stringify({
    specId: 'g-legacy2', url: 'https://old.example', port: 5, pid: 999999, createdAt: 'then',
  }));
  await p.restore();
  assert.equal(readShare('g-legacy2'), null);
}));

test('restore drops a record whose spec is gone', () => withHome(async () => {
  seed('g-orphan');
  const first = mkPubs();
  const rec = await first.pubs.share('g-orphan');
  rmSync(specDir('g-orphan'), { recursive: true, force: true });

  const second = restart(first);
  await second.pubs.restore();
  assert.equal(second.pubs.resolve(rec.token), null, 'a token for a deleted spec resolves to nothing');
  assert.equal(second.pubs.list().length, 0);
}));

test('restart keeps the records and does not stop the tunnels', async () => {
  seed('omega');
  const first = mkPubs();
  const rec = await first.pubs.share('omega');
  assert.equal(first.publish.calls.length, 1);

  const second = restart(first);
  assert.equal(readShare('omega').token, rec.token, 'the record survives');
  assert.equal(second.publish.stopped.length, 0, 'no tunnel was stopped on the way down');
  assert.equal(second.publish.calls.length, 1, 'and the call count carries over');
  assert.equal(second.pubs.list().length, 0, 'the new registry starts empty, as a new process would');
});

// ---- lifecycle races (these predate the gateway and still have to hold) ----

// share() awaits a tunnel before it can record anything, so two overlapping
// calls would both pass the "already published?" check. The loser's tunnel would
// then be public with nothing tracking it and no way to stop it.
test('overlapping shares start one tunnel, not two', async () => {
  seed('zeta');
  const { pubs: p, publish } = mkPubs();
  const [a, b, c] = await Promise.all([p.share('zeta'), p.share('zeta'), p.share('zeta')]);
  assert.equal(publish.calls.length, 1, 'only one tunnel was started');
  assert.equal(a.url, b.url);
  assert.equal(b.url, c.url);
  assert.equal(p.list().length, 1);
  await p.stopAll();
});

test('overlapping shares of different specs still start one tunnel', async () => {
  seed('zeta1'); seed('zeta2');
  const { pubs: p, publish } = mkPubs();
  const [a, b] = await Promise.all([p.share('zeta1'), p.share('zeta2')]);
  assert.equal(publish.calls.length, 1);
  assert.notEqual(a.token, b.token);
  assert.equal(p.list().length, 2);
  await p.stopAll();
});

test('a failed share does not poison the next attempt', async () => {
  seed('eta');
  let attempt = 0;
  const flaky = async (port) => {
    if (++attempt === 1) throw new Error('cloudflared exited before publishing');
    return { url: `https://ok-${port}.example`, pid: 1, stop: async () => {} };
  };
  const { pubs: p } = mkPubs({ publishImpl: flaky });
  await assert.rejects(() => p.share('eta'), /exited/);
  const rec = await p.share('eta');
  assert.match(rec.url, /^https:\/\/ok-/, 'the retry publishes');
  await p.stopAll();
});

// A share that has not finished starting is in neither the registry nor the
// store, so a revoke that only sweeps the registry misses it, and it publishes
// itself moments later having outlived the thing meant to stop it.
test('revoking a share that is still starting still stops it', async () => {
  seed('iota');
  let release;
  const held = new Promise((r) => { release = r; });
  const stopped = [];
  const slow = async (port) => {
    await held;
    return { url: `https://slow-${port}.example`, pid: 3, stop: async () => stopped.push(port) };
  };
  const { pubs: p } = mkPubs({ publishImpl: slow });
  const sharing = p.share('iota');
  const revoking = p.unshare('iota');   // arrives before the tunnel is up
  release();
  await sharing;
  await revoking;
  assert.equal(stopped.length, 1, 'the tunnel that landed late was stopped');
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
  const { pubs: p } = mkPubs({ publishImpl: slow });
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

// A tunnel takes seconds to come up, and the spec can be deleted in that window.
// Publishing it afterwards would serve a spec that no longer exists, and
// writeShare would recreate the directory the delete had just removed.
test('a share whose spec is deleted mid-startup publishes nothing', async () => {
  seed('mu');
  let release;
  const held = new Promise((r) => { release = r; });
  const stopped = [];
  const slow = async (port) => {
    await held;
    return { url: `https://slow-${port}.example`, pid: 5, stop: async () => stopped.push(port) };
  };
  const { pubs: p } = mkPubs({ publishImpl: slow });
  const sharing = p.share('mu');
  rmSync(specDir('mu'), { recursive: true, force: true });
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
  const { pubs: p, publish } = mkPubs();
  let refused = null;
  await p.unshareThen('nu', async () => {
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
  const { pubs: p } = mkPubs();
  await p.unshareThen('xi', async () => {});
  const rec = await p.share('xi');
  assert.ok(rec.url, 'the door reopens');
  await p.stopAll();
});

test('a share arriving after shutdown is refused rather than leaked', async () => {
  seed('lambda');
  const { pubs: p } = mkPubs();
  await p.stopAll();
  await assert.rejects(() => p.share('lambda'), /shutting down/);
  assert.equal(readShare('lambda'), null);
});

test('unsharing something unpublished is not an error', async () => {
  seed('rho');
  const { pubs: p } = mkPubs();
  assert.equal(await p.unshare('rho'), false);
});

test('sharing an unknown spec fails rather than publishing nothing', async () => {
  const { pubs: p } = mkPubs();
  await assert.rejects(() => p.share('nosuchspec'), /unknown spec/i);
});

// A publish that fails must not leave a listening socket behind.
test('a failed tunnel leaves no gateway and no record', async () => {
  seed('sigma');
  const boom = async () => { throw new Error('cloudflared is not installed'); };
  const { pubs: p } = mkPubs({ publishImpl: boom });
  await assert.rejects(() => p.share('sigma'), /not installed/);
  assert.equal(readShare('sigma'), null);
  assert.equal(p.list().length, 0);
  assert.equal(p.localPort(), null, 'the gateway was closed again');
});

test('stopAll takes down the tunnel and closes the gateway', async () => {
  seed('g-stop');
  const { pubs: p, publish } = mkPubs();
  const rec = await p.share('g-stop');
  const port = p.localPort();
  await p.stopAll();
  assert.equal(publish.stopped.length, 1);
  assert.equal(p.origin(), null);
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/s/${rec.token}`), 'the socket is closed');
});

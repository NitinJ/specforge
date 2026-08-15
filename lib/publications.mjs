// Publication lifecycle: what is public right now, on what origin, and how it
// stops.
//
// The daemon owns this, which is what lets a publication outlive the terminal
// that created it and gives shutdown one place to reap the tunnel.
//
// One gateway serves every published spec and one tunnel exposes the gateway.
// The previous design gave each spec its own listener and its own tunnel, which
// meant a hostname per spec and a port assigned by the OS per publication; both
// died with the daemon, so every URL ever sent stopped working on restart. Here
// a spec's address is the tunnel's origin plus a token, so publishing another
// spec starts nothing and the origin is the only thing that has to be kept
// alive.
//
// Two pieces of state, both of which have to be right for a link to work:
//   published  token -> specId, mirrored to share.json per spec
//   tunnel     one process, running while at least one spec is published

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readMeta } from './meta.mjs';
import { specsDir } from './store-paths.mjs';
import {
  readShare, writeShare, clearShare, isLegacyShare, readShareToken,
} from './store-share.mjs';
import {
  normalizeProjectName, readProjectShareToken, writeProjectShare,
  clearProjectShare, listProjectShares,
} from './store-project-shares.mjs';
import { readGlobalPrefs } from './global-prefs.mjs';
import { readTunnel, writeTunnel, clearTunnel } from './store-tunnel.mjs';
import { readConfig } from './store-config.mjs';
import { createGatewayServer } from './gateway.mjs';
import { publishViaCloudflared } from './publish.mjs';
import { newToken, isToken } from './tokens.mjs';

/** Default loopback port for the gateway, and how far it will walk on a clash. */
export const GATEWAY_PORT = 14180;
export const GATEWAY_PORT_LIMIT = 19;
/** How long a leftover tunnel gets to prove it still answers before it is reaped. */
export const PROBE_TIMEOUT_MS = 8000;
/** How long an adopted tunnel gets to exit on SIGTERM before SIGKILL. */
export const KILL_TIMEOUT_MS = 5000;
const KILL_POLL_MS = 150;
const PS_TIMEOUT_MS = 2000;

/** Whether a pid names a running process. Signal 0 tests without delivering. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists and belongs to someone else, which still counts.
    return e.code === 'EPERM';
  }
}

/**
 * Whether a pid is actually our tunnel.
 *
 * A pid is not a durable handle. The recorded cloudflared can exit and the
 * kernel can hand that number to something else, after which "is it alive" says
 * yes about a stranger. Every signal this module sends to a recorded pid goes
 * through this check first, because the failure it prevents is killing an
 * unrelated process on the owner's machine.
 *
 * Unverifiable counts as not ours. That can leave a tunnel running with nothing
 * tracking it, which is the lesser of the two harms.
 */
function pidIsCloudflared(pid, localPort) {
  // Both halves are needed. "cloudflared" alone matches an editor holding a file
  // by that name, or a second cloudflared serving something else entirely; the
  // port is what makes it this tunnel, since the spawn passes
  // `--url http://127.0.0.1:<localPort>`.
  const matches = (argv) => argv.includes('cloudflared') && argv.includes(`127.0.0.1:${localPort}`);
  try {
    // procfs is authoritative and free. NUL-separated argv, so a substring test
    // over the whole blob is the right shape.
    return matches(readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
  } catch { /* not Linux, or the process is gone */ }
  try {
    return matches(execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8', timeout: PS_TIMEOUT_MS,
    }));
  } catch {
    return false;
  }
}

/**
 * Whether an origin answers.
 *
 * A live pid is not enough: cloudflared stays up when its edge connection is
 * gone, so a record can name a running process whose URL returns nothing. Any
 * status at all counts, including a 404, because the question is whether the
 * tunnel is carrying traffic rather than what the gateway said.
 */
async function probeOrigin(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return !!res && res.status < 500;
  } catch {
    return false;
  }
}

/**
 * @param {object} deps
 * @param {Function} [deps.publishImpl] turns a loopback port into a public URL;
 *   the fake in publish.mjs lets every caller be tested without a network or a
 *   cloudflared binary.
 * @param {Function} [deps.serverImpl] builds the gateway from a token resolver.
 * @param {Function} [deps.killImpl] reaps a pid left by a previous daemon.
 * @param {number} [deps.port] gateway port; 0 in tests, which binds anywhere.
 */
export function createPublications(deps = {}) {
  const {
    publishImpl = publishViaCloudflared,
    serverImpl = createGatewayServer,
    killImpl = (pid, signal = 'SIGTERM') => process.kill(pid, signal),
    aliveImpl = pidAlive,
    ownsImpl = pidIsCloudflared,
    probeImpl = probeOrigin,
    sleepImpl = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); }),
    killTimeoutMs = KILL_TIMEOUT_MS,
    port: basePort = GATEWAY_PORT,
    portLimit = GATEWAY_PORT_LIMIT,
    publicOrigin = readConfig().publicOrigin || null,
  } = deps;

  /**
   * Whether the tunnel is ours to run.
   *
   * With publicOrigin set it is a named cloudflared or a Funnel someone runs as
   * a service, and every process this module would start, adopt or kill belongs
   * to them. All this side has to do then is keep the gateway on the port their
   * config points at.
   */
  const ownsTunnel = !publicOrigin;

  /** token -> specId, for everything published right now. */
  const published = new Map();
  /** specId -> token, so a republish can find the token it already has. */
  const tokens = new Map();
  /** token -> project name, for every project published right now. */
  const publishedProjects = new Map();
  /** project name -> token, so a republish can find the token it already has. */
  const projectTokens = new Map();

  /** Whether anything at all is being served: spec or project. */
  function anyPublished() {
    return published.size > 0 || publishedProjects.size > 0;
  }

  /** The gateway listener, or null when nothing is published. */
  let server = null;
  /** The tunnel: { url, pid, stop, alive } or null. */
  let tunnel = null;

  /**
   * specId -> in-flight share.
   *
   * share() awaits a tunnel before it can record anything, so two overlapping
   * calls would both pass the "already published?" check and the loser's record
   * would overwrite the winner's. Callers joining an in-flight share wait for it.
   */
  const inflight = new Map();

  // Set once teardown begins. A share that started after stopAll had collected
  // its work would register a publication nothing is left to stop.
  let closed = false;

  /**
   * Specs being deleted right now.
   *
   * Checking that a spec exists, even at the commit point, is not enough: a
   * share can pass that check in the window between the revoke and the directory
   * being removed, commit, and then have its record deleted out from under it,
   * leaving a public token for a spec that is gone.
   */
  const deleting = new Set();

  /** The public origin, or null when nothing is exposed. */
  function origin() {
    return tunnel ? tunnel.url : null;
  }

  /** The loopback port the gateway is bound to, or null. */
  function localPort() {
    return server ? server.address().port : null;
  }

  /** A spec's public address. Null when there is no origin to put it on. */
  function urlFor(token) {
    return tunnel ? `${tunnel.url}/s/${token}` : null;
  }

  /**
   * token -> specId, for the gateway.
   *
   * Called per request, so an unshare takes effect on the next request rather
   * than at the next restart. Validates the shape before the lookup so nothing a
   * request path can carry reaches the map.
   */
  function resolve(token) {
    if (!isToken(token)) return null;
    return published.get(token) || null;
  }

  /**
   * Bind the gateway, walking forward if the port is taken.
   *
   * @param {number} [want] bind exactly this port and do not walk. Used when
   *   adopting: the tunnel already points at one port, and any other port makes
   *   the tunnel useless, so failing here is what tells the caller to give up on
   *   adopting rather than quietly serve somewhere the tunnel is not looking.
   */
  async function bindGateway(want) {
    if (server) return server;
    const srv = serverImpl(resolve);
    const from = want == null ? basePort : want;
    const last = want != null ? want : (basePort === 0 ? 0 : basePort + portLimit);
    for (let p = from; ; p += 1) {
      try {
        await new Promise((resolve_, reject) => {
          const onError = (e) => { srv.off('listening', onListening); reject(e); };
          const onListening = () => { srv.off('error', onError); resolve_(); };
          srv.once('error', onError);
          srv.once('listening', onListening);
          srv.listen(p, '127.0.0.1');
        });
        server = srv;
        return srv;
      } catch (e) {
        if (e.code !== 'EADDRINUSE' || p >= last) {
          await new Promise((r) => srv.close(r));
          throw e;
        }
      }
    }
  }

  /**
   * Release the gateway socket without touching the tunnel.
   *
   * That pairing is what process death does: sockets close, a detached child
   * does not. Exported so the daemon can hand the port over cleanly and so tests
   * can model a crash.
   */
  async function closeGateway() {
    if (!server) return;
    const srv = server;
    server = null;
    await new Promise((r) => srv.close(r));
  }

  /**
   * Tunnel work runs strictly one at a time.
   *
   * Bringing the tunnel up and taking it down both span awaits measured in
   * seconds (cloudflared starting, a process being signalled and confirmed
   * gone), and they mutate the same three things: `tunnel`, the gateway socket
   * and the record on disk. Interleaved, a share landing during a slow retire
   * gets its record deleted and its gateway closed by the retire that started
   * first, which leaves a link that is dead and a process nothing is tracking.
   * Serialising is what makes each of them see a settled world.
   */
  let tunnelWork = Promise.resolve();
  function serializeTunnel(fn) {
    const run = tunnelWork.then(fn, fn);
    tunnelWork = run.then(() => {}, () => {});
    return run;
  }

  /** Bring the gateway and the tunnel up, once, however many callers ask. */
  function ensureExposed() {
    return serializeTunnel(async () => {
      if (tunnel && (!tunnel.alive || tunnel.alive())) return tunnel;
      if (!ownsTunnel) {
        // Exactly the configured port, never a walk. Their tunnel points at one
        // port; serving anywhere else would leave it aimed at nothing while
        // every link here reported healthy.
        await bindGateway(basePort);
        tunnel = {
          url: publicOrigin,
          pid: null,
          stop: async () => true,
          // Whether their tunnel is actually up is theirs to watch. This says
          // the gateway behind it is serving, which is the only half we own.
          alive: () => true,
        };
        return tunnel;
      }
      // A tunnel that died on its own is replaced rather than reused, so that
      // "share again" is able to fix a broken link.
      if (tunnel) {
        const dead = tunnel;
        tunnel = null;
        try { await dead.stop(); } catch { /* the process is what died */ }
      }
      await bindGateway();
      let started;
      try {
        started = await publishImpl(localPort());
      } catch (e) {
        // Never leave a listening socket behind a publish that failed.
        if (!anyPublished()) await closeGateway();
        throw e;
      }
      tunnel = started;
      try {
        recordTunnel();
      } catch (e) {
        // A running tunnel with no record is a public endpoint nothing can
        // adopt or reap, which is worse than no tunnel. Take it back down.
        tunnel = null;
        try { await started.stop(); } catch { /* best effort */ }
        if (!anyPublished()) await closeGateway();
        throw e;
      }
      return tunnel;
    });
  }

  /**
   * Stop a tunnel we only have a pid for, and report whether it is really gone.
   *
   * The spawned path gets this from the child handle: it waits for `exit` and
   * escalates. An adopted tunnel has no handle, so the same guarantee has to be
   * rebuilt from polling, and it has to be a guarantee rather than a hope,
   * because the caller deletes the pid record afterwards. Resolving early would
   * mean deleting the only route back to a process that is still serving.
   *
   * @returns {Promise<boolean>} false when the process is still there, or when
   *   it could not be confirmed as ours to signal
   */
  async function stopRecorded(pid, localPort) {
    if (!aliveImpl(pid)) return true;
    // Never signal a pid we cannot confirm: the tunnel may have exited and the
    // number been reused by something that has nothing to do with us.
    if (!ownsImpl(pid, localPort)) return false;

    const deadline = Date.now() + killTimeoutMs;
    try { killImpl(pid, 'SIGTERM'); } catch { return !aliveImpl(pid); }
    while (aliveImpl(pid) && Date.now() < deadline) await sleepImpl(KILL_POLL_MS);
    if (!aliveImpl(pid)) return true;

    // Still there. Re-check ownership before escalating, since it has had the
    // whole grace period to exit and let its number be taken.
    if (!ownsImpl(pid, localPort)) return false;
    try { killImpl(pid, 'SIGKILL'); } catch { return !aliveImpl(pid); }
    const hardDeadline = Date.now() + killTimeoutMs;
    while (aliveImpl(pid) && Date.now() < hardDeadline) await sleepImpl(KILL_POLL_MS);
    return !aliveImpl(pid);
  }

  /**
   * Write down where the tunnel is and what process it is.
   *
   * The pid is the only route back to a detached cloudflared once this daemon is
   * gone, and the port is the only way the next one can put a gateway back under
   * it. Without both, an adopted tunnel is unreachable and an abandoned one is
   * unkillable.
   */
  function recordTunnel() {
    // Nothing to record for a tunnel we do not run: there is no pid of ours to
    // find later, and the origin is in config rather than discovered.
    if (!ownsTunnel) return;
    if (!tunnel || tunnel.pid == null || localPort() == null) return;
    writeTunnel({
      url: tunnel.url,
      pid: tunnel.pid,
      localPort: localPort(),
      createdAt: new Date().toISOString(),
    });
  }

  /** Take the tunnel down once nothing is published. */
  function retireIfIdle() {
    if (anyPublished()) return Promise.resolve();
    return serializeTunnel(async () => {
      // Re-checked inside the lock: something may have published between the
      // call and this turn.
      if (anyPublished()) return;
      let stopped = true;
      if (tunnel) {
        const t = tunnel;
        tunnel = null;
        try { stopped = (await t.stop()) !== false; } catch { stopped = false; }
      }
      // And again, because stopping an adopted tunnel waits on a process. A
      // share that landed meanwhile is queued behind this and will bring a new
      // tunnel up, so clearing the record or closing the gateway now would
      // delete state that belongs to it.
      if (anyPublished()) return;
      // The record is the only route back to a detached process, so it outlives
      // any stop that could not confirm the process is gone. A stale record
      // costs one reap attempt on the next start; a deleted one costs an
      // untrackable public endpoint.
      if (stopped) clearTunnel();
      await closeGateway();
    });
  }

  /**
   * Publish a spec, or return the publication it already has.
   *
   * Idempotent on purpose: sharing twice is what someone does when they lost the
   * link, and it must not mint a second token, because the first one is in an
   * email somewhere.
   *
   * @param {string} id
   * @param {{rotate?:boolean}} [opts] rotate revokes the current token and mints
   *   a new one, which is the only way to kill a link that has been sent.
   */
  function share(id, opts = {}) {
    if (closed) return Promise.reject(new Error('the daemon is shutting down'));
    if (deleting.has(id)) return Promise.reject(new Error(`spec ${id} is being deleted`));
    const pending = inflight.get(id);
    if (pending) return pending;
    const p = startShare(id, opts).finally(() => { inflight.delete(id); });
    inflight.set(id, p);
    return p;
  }

  async function startShare(id, { rotate = false } = {}) {
    if (!readMeta(id)) throw new Error(`unknown spec ${id}`);

    // The token on disk is the one in whatever was already sent, so it is
    // reused whether or not the spec is published right now: a re-share after an
    // unshare has to hand back the URL people have, and rotate is the only thing
    // that changes it (D12).
    let token = tokens.get(id) || readShareToken(id);
    if (rotate || !isToken(token)) token = newToken();

    await ensureExposed();

    // Re-checked at the commit point, because a tunnel takes seconds to come up
    // and the world can change underneath it. If the spec was deleted meanwhile,
    // writeShare would recreate its directory and the token would serve a spec
    // that no longer exists; if shutdown began, this would publish after the
    // sweep that was meant to stop it.
    if (closed || deleting.has(id) || !readMeta(id)) {
      await retireIfIdle();
      throw new Error(closed ? 'the daemon is shutting down'
        : deleting.has(id) ? `spec ${id} is being deleted` : `unknown spec ${id}`);
    }

    // Rotation drops the old token from the map before the new one lands, so
    // there is no moment where both resolve.
    const previous = tokens.get(id);
    if (previous && previous !== token) published.delete(previous);

    published.set(token, id);
    tokens.set(id, token);
    const record = { specId: id, token, createdAt: new Date().toISOString() };
    writeShare(id, record);
    return { ...record, url: urlFor(token) };
  }

  /**
   * Whether this spec's publication actually serves right now.
   *
   * Membership is not enough: cloudflared can die on its own, leaving every
   * published spec looking fine while no URL answers. Anything that tells a
   * human "this link works" has to ask the tunnel.
   */
  function isLive(id) {
    if (!tokens.has(id)) return false;
    if (!tunnel) return false;
    return tunnel.alive ? !!tunnel.alive() : true;
  }

  /** @returns {Promise<boolean>} whether anything was published */
  async function unshare(id) {
    // A share still waiting on its tunnel is not in the map yet, and would
    // register itself the moment this finished: a publication that outlived its
    // own revocation. Let it land first, then take it down.
    const pending = inflight.get(id);
    if (pending) {
      try { await pending; } catch { /* it failed, so there is nothing to stop */ }
    }
    const token = tokens.get(id);
    tokens.delete(id);
    if (token) published.delete(token);
    const had = clearShare(id) || !!token;
    await retireIfIdle();
    return had;
  }

  /**
   * Revoke a spec's publication, then run `fn` with new shares for it refused
   * for as long as `fn` takes.
   *
   * Deleting a spec removes the directory holding its record, so a share that
   * commits anywhere inside that operation ends up as a live token for a spec
   * that no longer exists. Holding the door for the whole delete removes the
   * window rather than narrowing it.
   */
  async function unshareThen(id, fn) {
    deleting.add(id);
    try {
      await unshare(id);
      return await fn();
    } finally {
      deleting.delete(id);
    }
  }

  function list() {
    return [...tokens.entries()].map(([specId, token]) => ({
      specId, token, url: urlFor(token),
    }));
  }

  // ------------------------------------------------------------- projects

  /** A project's public address. Null when there is no origin to put it on. */
  function urlForProject(token) {
    return tunnel ? `${tunnel.url}/p/${token}` : null;
  }

  /**
   * Whether a project exists to be shared: it names at least one spec, or the
   * index's project registry lists it. Both count, because a project created in
   * the UI is real before its first spec lands in it.
   */
  function projectExists(name) {
    if ((readGlobalPrefs().projects || []).includes(name)) return true;
    let ids = [];
    try {
      ids = readdirSync(specsDir(), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return false;
    }
    return ids.some((id) => {
      const m = readMeta(id);
      return m && (m.project || null) === name;
    });
  }

  /** project name -> in-flight share, the same race share() guards per spec. */
  const inflightProjects = new Map();

  /**
   * Publish a project, or return the publication it already has.
   *
   * Idempotent like share(): the second call returns the token already sent.
   * Membership is not recorded here at all — the gateway evaluates it per
   * request from spec meta, which is what makes a share cover future specs.
   */
  function shareProject(name, opts = {}) {
    if (closed) return Promise.reject(new Error('the daemon is shutting down'));
    const key = normalizeProjectName(name);
    if (!key) return Promise.reject(new Error('share-project: a project name is required'));
    const pending = inflightProjects.get(key);
    if (pending) return pending;
    const p = startShareProject(key, opts).finally(() => { inflightProjects.delete(key); });
    inflightProjects.set(key, p);
    return p;
  }

  async function startShareProject(key, { rotate = false } = {}) {
    if (!projectExists(key)) throw new Error(`unknown project ${key}`);

    let token = projectTokens.get(key) || readProjectShareToken(key);
    if (rotate || !isToken(token)) token = newToken();

    await ensureExposed();

    // Re-checked at the commit point, as startShare does: the tunnel takes time
    // to come up and shutdown may have begun underneath it.
    if (closed) {
      await retireIfIdle();
      throw new Error('the daemon is shutting down');
    }

    const previous = projectTokens.get(key);
    if (previous && previous !== token) publishedProjects.delete(previous);

    publishedProjects.set(token, key);
    projectTokens.set(key, token);
    const record = { token, createdAt: new Date().toISOString() };
    writeProjectShare(key, record);
    return { project: key, token, createdAt: record.createdAt, url: urlForProject(token) };
  }

  /** @returns {Promise<boolean>} whether the project was published */
  async function unshareProject(name) {
    const key = normalizeProjectName(name);
    const pending = inflightProjects.get(key);
    if (pending) {
      try { await pending; } catch { /* it failed, so there is nothing to stop */ }
    }
    const token = projectTokens.get(key);
    projectTokens.delete(key);
    if (token) publishedProjects.delete(token);
    const had = clearProjectShare(key) || !!token;
    await retireIfIdle();
    return had;
  }

  /**
   * token -> project name, for the gateway. Per request, like resolve(), so an
   * unshare takes effect on the next request.
   */
  function resolveProject(token) {
    if (!isToken(token)) return null;
    return publishedProjects.get(token) || null;
  }

  /** How many specs carry this project name right now. */
  function countProjectSpecs(name) {
    let ids = [];
    try {
      ids = readdirSync(specsDir(), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return 0;
    }
    return ids.filter((id) => {
      const m = readMeta(id);
      return m && (m.project || null) === name;
    }).length;
  }

  function listProjects() {
    // The spec count rides along because `shares` is the visibility surface: a
    // share left serving an emptied project (every spec renamed away) shows as
    // "0 specs" instead of looking healthy.
    return [...projectTokens.entries()].map(([project, token]) => ({
      project, token, url: urlForProject(token), specs: countProjectSpecs(project),
    }));
  }

  /** A project's publication as a caller sees it: where it is, whether it works. */
  function projectShareInfo(name) {
    const key = normalizeProjectName(name);
    const token = projectTokens.get(key);
    if (!token) return null;
    const live = tunnel ? (tunnel.alive ? !!tunnel.alive() : true) : false;
    return { token, url: urlForProject(token), live };
  }

  /**
   * What this spec's publication looks like to a caller: where it is and whether
   * it works.
   *
   * The URL is composed here rather than read from disk, because the origin
   * belongs to the tunnel and can change without any record changing. `live` is
   * the part that matters: a record is not proof the link serves.
   *
   * @returns {{url:string|null, token:string, createdAt:string, live:boolean}|null}
   */
  function shareInfo(id) {
    const rec = readShare(id);
    if (!rec) return null;
    return {
      url: urlFor(rec.token), token: rec.token, createdAt: rec.createdAt, live: isLive(id),
    };
  }

  /**
   * Rebuild the registry from disk, after a restart.
   *
   * The tunnel and the gateway died with the previous daemon, but the tokens did
   * not, and they are what the links people were sent are made of. Republishing
   * on the same tokens is what makes those links keep working.
   *
   * Records from the per-spec-tunnel scheme cannot be honoured: they name a port
   * that is gone. Their pid is reaped first, because a cloudflared child
   * survives a SIGKILLed parent and the record is the only route back to it.
   */
  async function restore() {
    let ids = [];
    try {
      ids = readdirSync(specsDir(), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return;
    }
    for (const id of ids) {
      const legacy = isLegacyShare(id);
      if (legacy) {
        if (legacy.pid) {
          try { killImpl(legacy.pid); } catch { /* already gone */ }
        }
        clearShare(id);
        continue;
      }
      const rec = readShare(id);
      if (!rec || !readMeta(id)) continue;
      published.set(rec.token, id);
      tokens.set(id, rec.token);
    }
    // Project shares restore on the same tokens for the same reason spec shares
    // do: the links people were sent are made of them. A record whose project no
    // longer exists is pruned instead: a project rename in the UI moves every
    // spec to the new name, so the old share would serve an empty page and hold
    // the tunnel open for nothing. The token stays in the record, so recreating
    // the project name and re-sharing returns the URL that was already sent.
    for (const rec of listProjectShares()) {
      if (!projectExists(rec.project)) {
        clearProjectShare(rec.project);
        continue;
      }
      publishedProjects.set(rec.token, rec.project);
      projectTokens.set(rec.project, rec.token);
    }
    if (!ownsTunnel) {
      // A tunnel this daemon recorded is left over from before an origin was
      // configured. Nothing points at it any more, so it is reaped rather than
      // left running as a second public endpoint for the same gateway.
      await reapRecordedTunnel();
      if (anyPublished()) await ensureExposed();
      return;
    }
    if (!anyPublished()) {
      // Nothing to serve, so a leftover tunnel is a public endpoint for nothing.
      await reapRecordedTunnel();
      return;
    }
    if (await adoptRecordedTunnel()) return;
    await ensureExposed();
  }

  /**
   * Take over the tunnel the previous daemon left, if it is still worth having.
   *
   * Both checks are needed. The pid can be alive while the URL answers nothing,
   * because cloudflared stays up after losing its edge connection, and adopting
   * that would hand back an origin that is already dead. A URL can answer while
   * pointing at a port this process cannot bind, and serving on any other port
   * leaves the tunnel aimed at nothing.
   *
   * @returns {Promise<boolean>} whether the tunnel was adopted
   */
  async function adoptRecordedTunnel() {
    const rec = readTunnel();
    if (!rec) return false;
    // Alive is not enough: the number can have been reused since it was written.
    if (!aliveImpl(rec.pid) || !ownsImpl(rec.pid, rec.localPort)) {
      await reapRecordedTunnel();
      return false;
    }
    try {
      await bindGateway(rec.localPort);
    } catch {
      // D8: the port is taken by something else. A gateway anywhere else is not
      // where this tunnel is pointing, so it is reaped and a fresh one is
      // started on a new port, which does mean a new origin.
      await reapRecordedTunnel();
      return false;
    }
    // Probed only now. The gateway is what the tunnel points at, so before it is
    // bound the origin answers 530 by definition and no tunnel could ever be
    // adopted. Binding first is what makes this question answerable.
    if (!await probeImpl(rec.url)) {
      await reapRecordedTunnel();
      // The gateway stays bound: it is a usable port and the fresh tunnel about
      // to be started can point at it.
      return false;
    }
    tunnel = {
      url: rec.url,
      pid: rec.pid,
      // Rebuilt from the pid rather than a child handle, and it reports whether
      // the process is actually gone so the caller knows if the record can go.
      stop: () => stopRecorded(rec.pid, rec.localPort),
      // Deliberately the cheap check. This is polled once per spec on every
      // index render, and the ownership test costs a `ps` where there is no
      // procfs. Getting it wrong on a reused pid shows a stale badge; getting
      // the signalling wrong kills a stranger's process, which is why the
      // expensive check guards that and not this.
      alive: () => aliveImpl(rec.pid),
    };
    return true;
  }

  /**
   * Stop a recorded tunnel this daemon is not going to use, and drop the record
   * only once the process is confirmed gone.
   */
  async function reapRecordedTunnel() {
    const rec = readTunnel();
    if (!rec) return;
    if (await stopRecorded(rec.pid, rec.localPort)) clearTunnel();
  }

  /**
   * Take everything down, including shares still starting.
   *
   * Closes the door first so nothing new can appear behind the sweep, then loops
   * until nothing is in flight: a share that was mid-startup lands during the
   * first pass and is swept by the next.
   */
  async function stopAll() {
    closed = true;
    while (inflight.size || inflightProjects.size) {
      await Promise.allSettled([...inflight.values(), ...inflightProjects.values()]);
    }
    published.clear();
    tokens.clear();
    publishedProjects.clear();
    projectTokens.clear();
    // Queued behind any tunnel work still running, so a start that was mid-flight
    // is complete (and therefore stoppable) before the sweep looks at it.
    await retireIfIdle();
  }

  return {
    share, unshare, unshareThen, list, isLive, resolve, restore, stopAll,
    origin, localPort, shareInfo, closeGateway,
    shareProject, unshareProject, resolveProject, listProjects, projectShareInfo,
  };
}

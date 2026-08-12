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

import { readdirSync } from 'node:fs';
import { readMeta } from './meta.mjs';
import { specsDir } from './store-paths.mjs';
import { readShare, writeShare, clearShare, isLegacyShare } from './store-share.mjs';
import { createGatewayServer } from './gateway.mjs';
import { publishViaCloudflared } from './publish.mjs';
import { newToken, isToken } from './tokens.mjs';

/** Default loopback port for the gateway, and how far it will walk on a clash. */
export const GATEWAY_PORT = 14180;
export const GATEWAY_PORT_LIMIT = 19;

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
    killImpl = (pid) => process.kill(pid, 'SIGTERM'),
    port: basePort = GATEWAY_PORT,
    portLimit = GATEWAY_PORT_LIMIT,
  } = deps;

  /** token -> specId, for everything published right now. */
  const published = new Map();
  /** specId -> token, so a republish can find the token it already has. */
  const tokens = new Map();

  /** The gateway listener, or null when nothing is published. */
  let server = null;
  /** The tunnel: { url, pid, stop, alive } or null. */
  let tunnel = null;
  /** In-flight tunnel startup, so concurrent shares wait rather than race. */
  let starting = null;

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

  /** Bind the gateway, walking forward if the port is taken. */
  async function bindGateway() {
    if (server) return server;
    const srv = serverImpl(resolve);
    const last = basePort === 0 ? 0 : basePort + portLimit;
    for (let p = basePort; ; p += 1) {
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

  /** Close the gateway. Safe to call when it is not bound. */
  async function closeGateway() {
    if (!server) return;
    const srv = server;
    server = null;
    await new Promise((r) => srv.close(r));
  }

  /**
   * Bring the gateway and the tunnel up, once, however many callers ask.
   *
   * A second caller arriving while the first is still waiting on cloudflared
   * joins that attempt: starting a second tunnel would leave one of them public
   * with nothing tracking it.
   */
  function ensureExposed() {
    if (tunnel && (!tunnel.alive || tunnel.alive())) return Promise.resolve(tunnel);
    if (starting) return starting;
    starting = (async () => {
      // A tunnel that died on its own is replaced rather than reused, so that
      // "share again" is able to fix a broken link.
      if (tunnel) {
        try { await tunnel.stop(); } catch { /* the process is what died */ }
        tunnel = null;
      }
      await bindGateway();
      try {
        tunnel = await publishImpl(localPort());
      } catch (e) {
        // Never leave a listening socket behind a publish that failed.
        if (!published.size) await closeGateway();
        throw e;
      }
      return tunnel;
    })().finally(() => { starting = null; });
    return starting;
  }

  /** Take the tunnel down once nothing is published. */
  async function retireIfIdle() {
    if (published.size) return;
    if (tunnel) {
      const t = tunnel;
      tunnel = null;
      try { await t.stop(); } catch { /* already gone */ }
    }
    await closeGateway();
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

    // A record on disk with no entry in the map is from a previous daemon, and
    // its token is still the one in whatever was sent, so it is reused.
    let token = tokens.get(id) || (readShare(id) || {}).token;
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
    if (published.size) await ensureExposed();
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
    while (inflight.size) {
      await Promise.allSettled([...inflight.values()]);
    }
    published.clear();
    tokens.clear();
    if (starting) await Promise.allSettled([starting]);
    await retireIfIdle();
  }

  return {
    share, unshare, unshareThen, list, isLive, resolve, restore, stopAll,
    origin, localPort, shareInfo,
  };
}

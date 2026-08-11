// Publication lifecycle: what is public right now, and how it stops.
//
// The daemon owns this, which is what lets a publication outlive the terminal
// that created it and gives shutdown one place to reap tunnels. Each entry is a
// listener bound to one spec plus the tunnel pointing at it.

import { readdirSync } from 'node:fs';
import { readMeta } from './meta.mjs';
import { specsDir } from './store-paths.mjs';
import { readShare, writeShare, clearShare } from './store-share.mjs';
import { createPublicationServer } from './publication.mjs';
import { publishViaCloudflared } from './publish.mjs';

/**
 * @param {{publishImpl?:Function, serverImpl?:Function, killImpl?:Function}} deps
 *   publishImpl turns a loopback port into a public URL; the fake in publish.mjs
 *   lets every caller be tested without a network or a cloudflared binary.
 */
export function createPublications(deps = {}) {
  const {
    publishImpl = publishViaCloudflared,
    serverImpl = createPublicationServer,
    killImpl = (pid) => process.kill(pid, 'SIGTERM'),
  } = deps;

  /** specId -> { record, server, stop } */
  const live = new Map();
  /**
   * specId -> in-flight share.
   *
   * `share` awaits a port and a tunnel before it can record anything, so two
   * overlapping calls would both pass the `live` check and both start a tunnel.
   * The second record would overwrite the first, leaving a public tunnel that
   * nothing tracks and `unshare` cannot stop. Callers joining an in-flight
   * share wait for it instead.
   */
  const starting = new Map();

  /**
   * Publish a spec, or return the publication it already has.
   *
   * Idempotent on purpose: sharing twice is what someone does when they lost
   * the link, and it must not start a second tunnel.
   */
  // Set once teardown begins. A share that started after stopAll had collected
  // its work would register a tunnel nothing is left to stop, so the door is
  // shut rather than raced.
  let closed = false;

  /**
   * Specs being deleted right now.
   *
   * Checking that a spec exists, even at the commit point, is not enough: a
   * share can pass that check in the window between the revoke and the
   * directory being removed, commit, and then have its record deleted out from
   * under it, leaving a public tunnel for a spec that is gone and no record to
   * find it by. The delete holds this instead, so there is no window to hit.
   */
  const deleting = new Set();

  function share(id) {
    if (closed) return Promise.reject(new Error('the daemon is shutting down'));
    if (deleting.has(id)) return Promise.reject(new Error(`spec ${id} is being deleted`));
    const existing = live.get(id);
    if (existing) return Promise.resolve(existing.record);
    const inflight = starting.get(id);
    if (inflight) return inflight;
    const p = startShare(id).finally(() => { starting.delete(id); });
    starting.set(id, p);
    return p;
  }

  async function startShare(id) {
    if (!readMeta(id)) throw new Error(`unknown spec ${id}`);

    const server = serverImpl(id);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    let tunnel;
    try {
      tunnel = await publishImpl(port);
    } catch (e) {
      // Never leave a listening socket behind a publish that failed.
      await new Promise((r) => server.close(r));
      throw e;
    }

    // Re-checked at the commit point, because a tunnel takes seconds to come up
    // and the world can change underneath it. If the spec was deleted meanwhile,
    // writeShare would recreate its directory and the URL would serve a spec
    // that no longer exists; if shutdown began, this would install a tunnel
    // after the sweep that was meant to stop it.
    if (closed || deleting.has(id) || !readMeta(id)) {
      await tunnel.stop();
      await new Promise((r) => server.close(r));
      throw new Error(closed ? 'the daemon is shutting down'
        : deleting.has(id) ? `spec ${id} is being deleted` : `unknown spec ${id}`);
    }

    const record = {
      specId: id,
      url: tunnel.url,
      port,
      pid: tunnel.pid == null ? null : tunnel.pid,
      createdAt: new Date().toISOString(),
    };
    live.set(id, { record, server, stop: tunnel.stop });
    writeShare(id, record);
    return record;
  }

  /** @returns {Promise<boolean>} whether anything was published */
  async function unshare(id) {
    // A share still waiting on its tunnel is not in `live` yet, and would
    // register itself the moment this finished — a publication that outlived
    // its own revocation. Let it land first, then take it down.
    const inflight = starting.get(id);
    if (inflight) {
      try { await inflight; } catch { /* it failed, so there is nothing to stop */ }
    }
    const entry = live.get(id);
    live.delete(id);
    if (!entry) {
      clearShare(id); // a record with no live entry is from a previous daemon
      return false;
    }
    // Tunnel first: closing the socket while the tunnel is still up would serve
    // errors to a reviewer rather than nothing.
    await entry.stop();
    await new Promise((r) => entry.server.close(r));
    // The record is dropped last, and only once the tunnel is confirmed gone.
    // Dropping it first would mean a crash mid-revoke loses the pid, which is
    // the only way a later daemon can find and reap that tunnel.
    clearShare(id);
    return true;
  }

  /**
   * Revoke a spec's publication, then run `fn` with new shares for it refused
   * for as long as `fn` takes.
   *
   * Deleting a spec removes the directory holding its share record, so a share
   * that commits anywhere inside that operation ends up as a public tunnel for
   * a spec that no longer exists, with nothing left on disk to find it by.
   * Holding the door for the whole delete removes the window rather than
   * narrowing it.
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
    return [...live.values()].map((e) => e.record);
  }

  /**
   * Drop records left by a previous daemon, reaping any tunnel they still name.
   *
   * The listener died with that daemon, so the record is already wrong. A
   * cloudflared child survives a SIGKILLed parent, which is the case this
   * exists for: without it, a public endpoint outlives every trace of itself.
   */
  function clearStale() {
    let ids = [];
    try {
      ids = readdirSync(specsDir(), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return;
    }
    for (const id of ids) {
      if (live.has(id)) continue; // ours, and running
      const rec = readShare(id);
      if (!rec) continue;
      if (rec.pid) {
        try { killImpl(rec.pid); } catch { /* already gone */ }
      }
      clearShare(id);
    }
  }

  /**
   * Take every publication down, including ones still starting.
   *
   * Closes the door first so nothing new can appear behind the sweep, then
   * loops until both maps are empty: a share that was mid-flight lands during
   * the first pass and is stopped by the next one.
   */
  async function stopAll() {
    closed = true;
    while (starting.size || live.size) {
      await Promise.allSettled([...starting.values()]);
      await Promise.all([...live.keys()].map((id) => unshare(id)));
    }
  }

  return { share, unshare, unshareThen, list, clearStale, stopAll };
}

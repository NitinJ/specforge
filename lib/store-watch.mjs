// Headless orphan-drain for the daemon (design §5/§7). Batches for specs attached
// to a live session are drained in-session by that session's hooks. This loop
// only handles ORPHANED batches — specs with no attached session or a stale lock,
// which no session's hooks will ever pick up — by spawning a headless `claude -p`.
//
// Opt-in: the daemon starts this only when SPECFORGE_DAEMON_DRAIN is set, so the
// default daemon never spawns Claude unprompted. The drain action is injectable
// so the loop is testable without invoking Claude.

import { spawn } from 'node:child_process';
import { readMeta } from './meta.mjs';
import { isStale } from './attach.mjs';
import { listAllPending } from './store-inbox.mjs';
import { reviewReason } from './store-drain.mjs';

const CLAUDE_BIN = process.env.SPECFORGE_CLAUDE_BIN || 'claude';

/** Minimal shell-style tokenizer that keeps quoted values intact. */
export function tokenizeArgs(raw) {
  return (String(raw || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
    .map((s) => s.replace(/^['"]|['"]$/g, ''));
}

/** Pending batches with no live owner (unattached or stale lock). */
export function orphanedBatches() {
  return listAllPending().filter((b) => {
    const meta = readMeta(b.specId);
    return !meta || !meta.attachedSession || isStale(meta);
  });
}

/** Default drain: a headless Claude over the orphaned batches. */
export function spawnClaudeDrain(batches, log = () => {}, onChild = () => {}) {
  return new Promise((resolve) => {
    const extra = tokenizeArgs(process.env.SPECFORGE_WATCH_CLAUDE_ARGS);
    let child;
    try {
      child = spawn(CLAUDE_BIN, ['-p', reviewReason(batches), ...extra], { stdio: 'inherit' });
    } catch (e) {
      log(`drain: could not spawn ${CLAUDE_BIN} (${e.message})`);
      return resolve();
    }
    onChild(child);
    child.on('error', (e) => { log(`drain: ${CLAUDE_BIN} unavailable (${e.message})`); resolve(); });
    child.on('exit', () => resolve());
  });
}

/**
 * Single-flight loop that drains orphaned batches on an interval.
 * @param {{intervalMs?:number, drain?:Function, pending?:Function, log?:Function}} opts
 */
export function createDaemonDrain({ intervalMs = 90000, drain, pending = orphanedBatches, log = () => {} } = {}) {
  let currentChild = null;
  const registerChild = (c) => { currentChild = c; };
  const drainFn = drain || ((batches, register) => spawnClaudeDrain(batches, log, register));
  let timer = null;
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return; // never overlap drains
    const batches = pending();
    if (!batches.length) return;
    running = true;
    log(`drain: ${batches.length} orphaned batch(es)`);
    try {
      await drainFn(batches, registerChild);
    } catch (e) {
      log(`drain: failed (${e.message})`);
    } finally {
      running = false;
      currentChild = null;
    }
  }

  const api = {
    tick,
    start() {
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
      tick();
      return api;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (currentChild) { try { currentChild.kill('SIGTERM'); } catch { /* gone */ } }
    },
    get isRunning() { return running; },
  };
  return api;
}

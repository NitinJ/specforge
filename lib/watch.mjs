// Watch mode (hands-free review). A self-pacing poller that, when review batches
// are submitted while no one is driving the session, drains them by spawning a
// headless `claude -p` in the project — so replies appear unattended.
//
// Honest deviation from the design: a plugin cannot schedule the harness's
// session self-wake (ScheduleWakeup), so true hands-free is achieved with a
// headless Claude invocation instead. It is strictly opt-in (serve --watch).
//
// The drain action is injectable so the poller is testable without invoking
// Claude.

import { spawn } from 'node:child_process';
import { listPendingBatches } from './inbox.mjs';
import { reviewReason } from './drain.mjs';

const CLAUDE_BIN = process.env.SPECFORGE_CLAUDE_BIN || 'claude';

/** Minimal shell-style tokenizer that keeps quoted values (with spaces) intact. */
export function tokenizeArgs(raw) {
  return (String(raw || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
    .map((s) => s.replace(/^['"]|['"]$/g, ''));
}

/**
 * Default drain: run a headless Claude over the pending batches in the project.
 * Extra CLI args (e.g. a permission mode for unattended runs) can be supplied via
 * SPECFORGE_WATCH_CLAUDE_ARGS. `onChild` receives the spawned process so the
 * watcher can reap it on shutdown.
 */
export function spawnClaudeDrain(specsDir, projectDir, pending, log = () => {}, onChild = () => {}) {
  return new Promise((resolve) => {
    const reason = reviewReason(specsDir, pending);
    const extra = tokenizeArgs(process.env.SPECFORGE_WATCH_CLAUDE_ARGS);
    let child;
    try {
      child = spawn(CLAUDE_BIN, ['-p', reason, ...extra], { cwd: projectDir, stdio: 'inherit' });
    } catch (e) {
      log(`watch: could not spawn ${CLAUDE_BIN} (${e.message})`);
      return resolve();
    }
    onChild(child);
    child.on('error', (e) => {
      log(`watch: ${CLAUDE_BIN} not available (${e.message}) — install the Claude CLI for hands-free watch`);
      resolve();
    });
    child.on('exit', () => resolve());
  });
}

/**
 * Create a single-flight inbox poller.
 * @param {{specsDir:string, projectDir?:string, intervalMs?:number, drain?:Function, log?:Function}} opts
 */
export function createWatcher({ specsDir, projectDir = specsDir, intervalMs = 90000, drain, log = () => {} }) {
  let currentChild = null;
  const registerChild = (c) => { currentChild = c; };
  // drain receives (specsDir, pending, registerChild). The default spawns a
  // headless claude and registers it so stop() can reap it.
  const drainFn = drain || ((sd, pending, register) => spawnClaudeDrain(sd, projectDir, pending, log, register));
  let timer = null;
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return; // single-flight: never overlap drains
    const pending = listPendingBatches(specsDir);
    if (!pending.length) return;
    running = true;
    log(`watch: ${pending.length} pending batch(es) — draining`);
    try {
      await drainFn(specsDir, pending, registerChild);
    } catch (e) {
      log(`watch: drain failed (${e.message})`);
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
      if (currentChild) {
        try { currentChild.kill('SIGTERM'); } catch { /* already gone */ }
        currentChild = null;
      }
    },
    get isRunning() {
      return running;
    },
  };
  return api;
}

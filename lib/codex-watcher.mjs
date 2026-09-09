// Host-owned Codex adapter: poll SpecForge and queue work into the owning thread.
// Only lifecycle hook entry points start this child, never an agent shell tool.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionPath, sessionsDir } from './store-paths.mjs';
import { claimWorker, releaseWorker, workerFor, specsForSession, heartbeat, HEARTBEAT_MS } from './attach.mjs';
import { pendingWorkForSession, deliveryKey } from './store-drain.mjs';
import { isDirectRun, resolveHarness, resolveSessionId } from './harness-context.mjs';

const exec = promisify(execFile);
const MODE = 'codex-queue';
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// An exclusive host-side lock prevents two simultaneous hooks launching pollers.
function lockSession(session) {
  const path = `${sessionPath(session)}.codex-lock`;
  mkdirSync(sessionsDir(), { recursive: true });
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    if (pid > 0 ? alive(pid) : Date.now() - statSync(path).mtimeMs < 30_000) return null;
    rmSync(path, { force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let fd;
  try { fd = openSync(path, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => rmSync(path, { force: true });
}

export async function queueCodex(session, reason, env = process.env) {
  await exec('codex', ['queue', '--thread', session, '--message', reason], {
    env, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
}

export async function watchCodex(session, {
  env = process.env,
  deliver = (sid, reason) => queueCodex(sid, reason, env),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = (error) => console.error(error.message),
} = {}) {
  let unlock = lockSession(session);
  // A just-ended session may still be releasing its lock. Wait in the child,
  // never in the hook, so an immediate resume can restore delivery.
  if (!unlock && !workerFor(session)) {
    await sleep(HEARTBEAT_MS + 100);
    unlock = lockSession(session);
  }
  if (!unlock) return;
  let worker;
  const sentPath = `${sessionPath(session)}.codex-sent`;
  let sent = [];
  try { sent = JSON.parse(readFileSync(sentPath, 'utf8')); } catch { /* first start */ }
  try {
    worker = claimWorker(session, {
      harness: 'codex', mode: MODE,
      // Old tool-created Codex PID records are from a different namespace.
      alive: (pid) => workerFor(session)?.mode === MODE && alive(pid),
    });
    while (specsForSession(session).length && workerFor(session)?.leaseId === worker.leaseId) {
      const work = pendingWorkForSession(session, { ...env, SPECFORGE_HARNESS: 'codex' }, new Set(sent));
      try {
        if (work) {
          await deliver(session, work.reason);
          sent.push(...work.items.map((item) => deliveryKey(work.kind, item)));
          writeFileSync(sentPath, JSON.stringify(sent));
        }
        heartbeat(session);
      } catch (error) {
        // Keep work pending and stop renewing readiness until delivery recovers.
        onError(error);
      }
      await sleep(HEARTBEAT_MS);
    }
  } finally {
    if (worker) releaseWorker(session, worker.leaseId);
    unlock();
  }
}

/** Return immediately; the host child owns polling and queue delivery. */
export function startCodexWatcher(input, env = process.env) {
  if (resolveHarness(env) !== 'codex') return;
  const session = resolveSessionId(env, input.session_id || undefined);
  if (!session || !specsForSession(session).length) return;
  const worker = workerFor(session);
  if (worker?.mode === MODE && alive(worker.pid)) return;
  const log = openSync(`${sessionPath(session)}.codex-log`, 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), session], {
      env, detached: true, stdio: ['ignore', log, log],
    });
    child.on('error', () => {});
    child.unref();
  } finally { closeSync(log); }
}

export function stopCodexWatcher(session) {
  const worker = workerFor(session);
  if (worker?.mode !== MODE) return;
  releaseWorker(session, worker.leaseId);
  // The child observes the released lease on its next poll and exits cleanly.
}

if (isDirectRun(import.meta.url)) {
  watchCodex(process.argv[2]).catch((error) => { console.error(error); process.exitCode = 1; });
}

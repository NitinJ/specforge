#!/usr/bin/env node
// SpecForge — Stop hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately (sub-ms no-op for every non-spec session).
//
// For owned specs: route the work the human queued in the browser — a submitted
// review batch, or an export.
//
// It marks the session SEEN but does not beat. A turn here proves the window
// still exists, which keeps its ownership lock; it says nothing about whether
// anything is listening for comments, and stamping the heartbeat made every spec
// read connected for half an hour after its window closed. Only the review
// watcher beats (see lib/attach.mjs).
//
// Fail-safe: any error exits 0 so a SpecForge bug can never wedge a session.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { markSeen } from '../lib/attach.mjs';
import { pendingForSession, reviewReason, watcherBeating, armWatcherReason } from '../lib/store-drain.mjs';
import { exportRequestsForSession, exportReason } from '../lib/store-export.mjs';
import {
  generateRequestsForSession, generateReason,
} from '../lib/store-generate.mjs';
import { CODEX_HARNESS, isDirectRun, resolveHarness } from '../lib/harness-context.mjs';

export function run(input, env = process.env) {
  // Loop guard: if this stop already followed a stop-hook continuation, settle.
  if (input.stop_hook_active) return null;

  const { me, mine } = mineFor(env, input.session_id);
  if (!mine.length) return null; // ← idle no-op

  markSeen(me);

  // Pending review batches take priority — route to review-spec before settling.
  const batches = pendingForSession(me);
  if (batches.length) return { decision: 'block', reason: reviewReason(batches, env) };

  // Human clicked "Add a template" — route to the generate skill once. Ahead of
  // the export below because of who is waiting: an export lands in a Google Doc
  // the user opens later, while a template creation has a person sitting in
  // front of a dialog that named an ETA.
  const toGenerate = generateRequestsForSession(me);
  if (toGenerate.length) {
    return { decision: 'block', reason: generateReason(toGenerate, env) };
  }

  // Human clicked "Export to Google Docs" — route to the export skill once.
  const toExport = exportRequestsForSession(me);
  if (toExport.length) {
    return { decision: 'block', reason: exportReason(toExport, env) };
  }

  // Codex has next-turn delivery. An idle spec must not hold the turn open or
  // trigger another polling terminal. Pending work above still gets delivered.
  if (resolveHarness(env) === CODEX_HARNESS) return null;

  // Last: don't settle owning specs nobody is listening to. Blocking rather than
  // mentioning, because settling in that state IS the bug — a spec that takes
  // comments and delivers none of them, with the page saying Disconnected and the
  // human none the wiser. The stop_hook_active guard above caps this at one nag
  // per settle, and once a watcher is beating it never fires again.
  if (!watcherBeating(me)) {
    return { decision: 'block', reason: armWatcherReason(mine, env) };
  }

  return null;
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

if (isDirectRun(import.meta.url)) main().then(() => process.exit(0)).catch(() => process.exit(0));

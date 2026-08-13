#!/usr/bin/env node
// SpecForge — Stop hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately (sub-ms no-op for every non-spec session).
//
// For owned specs: bump their heartbeat (keeps the lock alive) and route the work
// the human queued in the browser — a submitted review batch, or an export.
//
// Fail-safe: any error exits 0 so a SpecForge bug can never wedge a session.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { heartbeat } from '../lib/attach.mjs';
import { pendingForSession, reviewReason } from '../lib/store-drain.mjs';
import { exportRequestsForSession, markExportWorking, exportReason } from '../lib/store-export.mjs';

export function run(input, env = process.env) {
  // Loop guard: if this stop already followed a stop-hook continuation, settle.
  if (input.stop_hook_active) return null;

  const { me, mine } = mineFor(env, input.session_id);
  if (!mine.length) return null; // ← idle no-op

  heartbeat(me);

  // Pending review batches take priority — route to review-spec before settling.
  const batches = pendingForSession(me);
  if (batches.length) return { decision: 'block', reason: reviewReason(batches) };

  // Human clicked "Export to Google Docs" — route to the export skill once.
  const toExport = exportRequestsForSession(me);
  if (toExport.length) {
    toExport.forEach((m) => markExportWorking(m.id));
    return { decision: 'block', reason: exportReason(toExport) };
  }

  return null;
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

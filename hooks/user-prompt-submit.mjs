#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately. Otherwise surface any pending review batches
// for those specs as context (drain routing — design §7).
//
// Like the Stop hook, it does not touch the heartbeat: a turn proves the session
// exists, not that anything is listening. Only the review watcher beats.
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { pendingForSession, reviewReason } from '../lib/store-drain.mjs';
import { exportRequestsForSession, markExportWorking, exportReason } from '../lib/store-export.mjs';

export function run(input, env = process.env) {
  const { me, mine } = mineFor(env, input.session_id);
  if (!mine.length) return null; // ← idle no-op
  const batches = pendingForSession(me);
  if (batches.length) {
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reviewReason(batches) } };
  }
  const toExport = exportRequestsForSession(me);
  if (toExport.length) {
    toExport.forEach((m) => markExportWorking(m.id));
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: exportReason(toExport) } };
  }
  return null;
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

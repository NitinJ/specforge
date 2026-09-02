#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately. Otherwise surface any pending review batches
// for those specs as context (drain routing — design §7).
//
// It marks the session SEEN but does not beat. A turn proves the window still
// exists, which is what the ownership lock needs; it says nothing about whether
// anything is listening for comments, which is what the heartbeat is asked and
// only the review watcher can answer.
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { markSeen } from '../lib/attach.mjs';
import { pendingForSession, reviewReason } from '../lib/store-drain.mjs';
import { exportRequestsForSession, markExportWorking, exportReason } from '../lib/store-export.mjs';
import {
  generateRequestsForSession, markGenerateWorking, generateReason,
} from '../lib/store-generate.mjs';

export function run(input, env = process.env) {
  const { me, mine } = mineFor(env, input.session_id);
  if (!mine.length) return null; // ← idle no-op
  markSeen(me);
  const batches = pendingForSession(me);
  if (batches.length) {
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reviewReason(batches, env) } };
  }
  // Ahead of the export for the same reason as in the Stop hook: someone is
  // watching a dialog for this one.
  const toGenerate = generateRequestsForSession(me);
  if (toGenerate.length) {
    toGenerate.forEach((m) => markGenerateWorking(m.id));
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: generateReason(toGenerate, env) } };
  }
  const toExport = exportRequestsForSession(me);
  if (toExport.length) {
    toExport.forEach((m) => markExportWorking(m.id));
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: exportReason(toExport, env) } };
  }
  return null;
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

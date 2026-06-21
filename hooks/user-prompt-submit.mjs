#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately. Otherwise bump the owned specs' heartbeat so
// an active session keeps its locks alive, and surface any pending review batches
// for those specs as context (drain routing — design §7).
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { heartbeat, recordFirstPrompt } from '../lib/attach.mjs';
import {
  pendingForSession, reviewReason,
  implementSignalsForSession, clearImplementSignal, implementReason,
} from '../lib/store-drain.mjs';

export function run(input, env = process.env) {
  const { me, mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op
  heartbeat(me);
  recordFirstPrompt(me, input.prompt); // friendly session label (once per spec)
  const batches = pendingForSession(me);
  if (batches.length) {
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reviewReason(batches) } };
  }
  const toImplement = implementSignalsForSession(me);
  if (toImplement.length) {
    toImplement.forEach((m) => clearImplementSignal(m.id));
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: implementReason(toImplement) } };
  }
  return null;
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

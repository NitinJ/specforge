#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately. Otherwise bump the owned specs' heartbeat so
// an active session keeps its locks alive every turn.
//
// (Surfacing pending review batches in-session is drain routing — design §7 —
// and lands in Stage 5; this hook does not surface them yet.)
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { heartbeat } from '../lib/attach.mjs';

export function run(input, env = process.env) {
  const { me, mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op
  heartbeat(me);
  return null;
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

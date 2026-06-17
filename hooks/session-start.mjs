#!/usr/bin/env node
// SpecForge — SessionStart hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A fresh session
// owns nothing (attachment happens later, via create/convert/open), so this is a
// sub-ms no-op in the common case.
//
// (Drain-fallback — surfacing batches submitted while no session was running —
// is drain routing, design §7, and lands in Stage 5. Reserved here.)
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';

export function run(input, env = process.env) {
  const { mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op
  return null; // Stage 5 wires drain-fallback for owned specs here.
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

#!/usr/bin/env node
// SpecForge — Stop hook.
//
// (a) Review-drain: if review batches were submitted in the browser, block the
//     stop and route Claude to the review-spec skill so it replies + amends
//     without the human having to type anything.
// (b) Implementation enforcement (Stage 6) hangs off the same hook.
//
// Fail-safe: any error exits 0 so a SpecForge bug can never wedge a session.

import { readStdin, parseInput } from './lib/io.mjs';
import { pendingForCwd, reviewReason } from '../lib/drain.mjs';

async function main() {
  const input = parseInput(await readStdin());

  // Loop guard: if this stop already followed a stop-hook continuation, do not
  // block again — let the session settle (the drain fallback will catch anything
  // still pending later).
  if (input.stop_hook_active) return;

  const cwd = input.cwd || process.cwd();
  const { specsDir, pending } = pendingForCwd(cwd);
  if (!pending.length) return;

  process.stdout.write(JSON.stringify({ decision: 'block', reason: reviewReason(specsDir, pending) }));
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

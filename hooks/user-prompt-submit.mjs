#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook.
//
// Drain fallback: surface pending review batches on the next human turn when no
// live session picked them up.
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { pendingForCwd, reviewReason } from '../lib/drain.mjs';

async function main() {
  const input = parseInput(await readStdin());
  const cwd = input.cwd || process.cwd();
  const { specsDir, pending } = pendingForCwd(cwd);
  if (!pending.length) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reviewReason(specsDir, pending) },
  }));
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

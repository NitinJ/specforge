#!/usr/bin/env node
// SpecForge — Stop hook.
//
// (a) Review-drain: if review batches were submitted in the browser, block the
//     stop and route Claude to the review-spec skill so it replies + amends
//     without the human having to type anything.
// (b) Impl-enforce: if a spec is being implemented and the evidence ledger shows
//     work that the spec wasn't updated to match, block with the drift nudges.
//
// Fail-safe: any error exits 0 so a SpecForge bug can never wedge a session.

import { readFileSync } from 'node:fs';
import { readStdin, parseInput } from './lib/io.mjs';
import { pendingForCwd, reviewReason } from '../lib/drain.mjs';
import { getActive } from '../lib/active.mjs';
import { readLedger, clearLedger } from '../lib/ledger.mjs';
import { computeDrift } from '../lib/enforce.mjs';
import { resolveSpec } from '../lib/paths.mjs';

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

async function main() {
  const input = parseInput(await readStdin());

  // Loop guard: if this stop already followed a stop-hook continuation, do not
  // block again — let the session settle.
  if (input.stop_hook_active) return;

  const cwd = input.cwd || process.cwd();
  const { specsDir, pending } = pendingForCwd(cwd);
  if (!specsDir) return;

  // (a) Pending review batches take priority.
  if (pending.length) {
    block(reviewReason(specsDir, pending));
    return;
  }

  // (b) Implementation drift.
  const active = getActive(specsDir);
  if (!active) return;
  const spec = resolveSpec(specsDir, active.specId);
  if (!spec) return;
  let html = '';
  try {
    html = readFileSync(spec.file, 'utf8');
  } catch {
    return;
  }
  const { nudges } = computeDrift(html, active, readLedger(specsDir));
  if (nudges.length) {
    // Acted on these events — clear so the same evidence doesn't re-nudge.
    clearLedger(specsDir);
    block(`SpecForge implementation check — keep the spec in sync before stopping:\n- ${nudges.join('\n- ')}\n\nUpdate via impl-cli, then continue.`);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

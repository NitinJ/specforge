#!/usr/bin/env node
// SpecForge — Stop hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A session that
// owns nothing returns immediately (sub-ms no-op for every non-spec session).
//
// For owned specs: bump their heartbeat (keeps the lock alive), and for any spec
// being implemented, run the drift check on its own spec.html + ledger and block
// with the nudges if work happened that the spec wasn't updated to match.
//
// Fail-safe: any error exits 0 so a SpecForge bug can never wedge a session.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { heartbeat } from '../lib/attach.mjs';
import { readMeta } from '../lib/meta.mjs';
import { readSpecHtml } from '../lib/store.mjs';
import { readLedger, clearLedger } from '../lib/store-ledger.mjs';
import { computeDrift } from '../lib/enforce.mjs';

export function run(input, env = process.env) {
  // Loop guard: if this stop already followed a stop-hook continuation, settle.
  if (input.stop_hook_active) return null;

  const { me, mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op

  heartbeat(me);

  const nudges = [];
  for (const id of mine) {
    const meta = readMeta(id);
    if (!meta || meta.status !== 'implementing') continue;
    let html;
    try {
      html = readSpecHtml(id);
    } catch {
      continue;
    }
    const active = { specId: id, stage: meta.stage ?? null, task: meta.task ?? null };
    const { nudges: n } = computeDrift(html, active, readLedger(id));
    if (n.length) {
      clearLedger(id); // acted on this evidence — don't re-nudge it
      nudges.push(...n.map((x) => `[${meta.title}] ${x}`));
    }
  }

  if (nudges.length) {
    return {
      decision: 'block',
      reason: `SpecForge implementation check — keep the spec in sync before stopping:\n- ${nudges.join('\n- ')}\n\nUpdate the spec, then continue.`,
    };
  }
  return null;
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

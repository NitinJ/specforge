#!/usr/bin/env node
// SpecForge — SessionStart hook (v2, session-aware).
//
// Gate: read $CLAUDE_CODE_SESSION_ID → the specs attached to it. A fresh session
// owns nothing (attachment happens later, via create/convert/open) → sub-ms no-op.
//
// When a RESUMED session already owns specs, the in-session review watcher
// (`wait-batch`) it had launched died with the previous run — and nothing else
// re-arms it. So nudge the agent to relaunch it, otherwise browser comments are
// only picked up on the next manual turn (the Stop/UserPromptSubmit hooks), never
// while idle.
//
// Fail-safe: any error exits 0.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { readMeta } from '../lib/meta.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'specforge-cli.mjs');

export function run(input, env = process.env) {
  const { mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op (the common fresh-session case)
  // Only arm for specs that can still receive review comments — a session owning
  // only `closed` specs has nothing for the watcher to deliver (it would spin forever).
  const active = mine.filter((id) => { const m = readMeta(id); return m && m.status !== 'closed'; });
  if (!active.length) return null;
  const context = [
    `SpecForge: this session owns ${active.length} spec(s) under browser review. The`,
    'in-session review watcher does not survive a restart — if it is not already',
    'running this session, relaunch it in the background so submitted comments are',
    'picked up while you are idle:',
    `  node "${CLI}" wait-batch`,
    'On completion it returns { ready, pending } — on ready, run specforge:review-spec',
    'for each pending spec then relaunch it; on timeout (ready:false) just relaunch.',
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

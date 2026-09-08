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
import { skillRef } from '../lib/skill-ref.mjs';
import {
  CODEX_HARNESS, isDirectRun, resolveHarness, resolvePluginRoot,
} from '../lib/harness-context.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'specforge-cli.mjs');

export function run(input, env = process.env) {
  const { mine } = mineFor(env, input.session_id);
  const codex = resolveHarness(env) === CODEX_HARNESS;
  const root = resolvePluginRoot(env) || dirname(dirname(fileURLToPath(import.meta.url)));
  const context = [];
  if (codex) {
    context.push(
      `SpecForge runtime root: ${root}`,
      'When a canonical SpecForge skill shows ${CLAUDE_PLUGIN_ROOT}, substitute the runtime root above in every file path and shell command.',
    );
  }
  if (!mine.length) {
    if (!context.length) return null;
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n') } };
  }
  context.push(
    `SpecForge: this session owns ${mine.length} spec(s) under browser review. The`,
    'in-session review watcher does not survive a restart — if it is not already',
    'running this session, relaunch it in the background so submitted comments are',
    'picked up while you are idle:',
    `  node "${CLI}" wait-batch`,
    `On completion it returns { ready, pending } — on ready, run ${skillRef('review-spec', env)}`,
    'for each pending spec then relaunch it. It does not expire on its own — it',
    'runs until a batch arrives or this session ends.',
  );
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n') } };
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

if (isDirectRun(import.meta.url)) main().then(() => process.exit(0)).catch(() => process.exit(0));

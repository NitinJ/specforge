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
import { dirname } from 'node:path';
import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { REVIEW_WAIT_CMD } from '../lib/store-drain.mjs';
import { startCodexWatcher } from '../lib/codex-watcher.mjs';
import {
  CODEX_HARNESS, PI_HARNESS, isDirectRun, resolveHarness, resolvePluginRoot,
} from '../lib/harness-context.mjs';

export function run(input, env = process.env) {
  const { mine } = mineFor(env, input.session_id);
  const harness = resolveHarness(env);
  const codex = harness === CODEX_HARNESS;
  const pi = harness === PI_HARNESS;
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
  if (codex) {
    context.push(
      `SpecForge: this thread owns ${mine.length} spec(s) under browser review.`,
      'SpecForge owns a background watcher that delivers submitted browser work automatically.',
      'Finish your turn normally. Do not start a watcher or wait for comments in a tool call.',
    );
  } else if (pi) {
    context.push(
      `SpecForge: this session owns ${mine.length} spec(s) under browser review.`,
      'The Pi extension owns review delivery and will arm it when this turn settles.',
    );
  } else {
    context.push(
      `SpecForge: this session owns ${mine.length} spec(s) under browser review. The`,
      'in-session review watcher does not survive a restart — if it is not already',
      'running this session, relaunch it in the background so submitted comments are',
      'picked up while you are idle:',
      `  ${REVIEW_WAIT_CMD}`,
      `On completion it returns { ready, kind, work, reason }. Follow reason, then relaunch it.`,
    );
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n') } };
}

async function main() {
  const input = parseInput(await readStdin());
  startCodexWatcher(input);
  const decision = run(input);
  if (decision) process.stdout.write(JSON.stringify(decision));
}

if (isDirectRun(import.meta.url)) main().then(() => process.exit(0)).catch(() => process.exit(0));

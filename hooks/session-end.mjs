#!/usr/bin/env node

import { readStdin, parseInput } from './lib/io.mjs';
import { isDirectRun, resolveSessionId } from '../lib/harness-context.mjs';
import { endSession } from '../lib/attach.mjs';
import { stopCodexWatcher } from '../lib/codex-watcher.mjs';

export function run(input, env = process.env) {
  const sessionId = resolveSessionId(env, input.session_id || undefined);
  if (!sessionId) return null;
  stopCodexWatcher(sessionId);
  return { stopped: endSession(sessionId) };
}

async function main() {
  run(parseInput(await readStdin()));
}

if (isDirectRun(import.meta.url)) main().then(() => process.exit(0)).catch(() => process.exit(0));

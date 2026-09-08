#!/usr/bin/env node

import { readStdin, parseInput } from './lib/io.mjs';
import { resolveSessionId } from '../lib/harness-context.mjs';
import { endSession } from '../lib/attach.mjs';

export function run(input, env = process.env) {
  const sessionId = resolveSessionId(env, input.session_id);
  if (!sessionId) return null;
  return { stopped: endSession(sessionId) };
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

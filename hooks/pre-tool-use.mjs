#!/usr/bin/env node
// SpecForge — PreToolUse hook (v2, session-aware).
//
// Closed-spec guard: deny edits to a spec this session owns whose meta.status is
// `closed` (final). Narrowly scoped — only fires when the edit targets one of
// the session's attached specs' spec.html. No-op for every other session/file.
//
// Fail-safe: any error exits 0 (fails open).

import { resolve as resolvePath } from 'node:path';
import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { readMeta } from '../lib/meta.mjs';
import { specHtmlPath } from '../lib/store.mjs';

export function run(input, env = process.env) {
  const file = input.tool_input && input.tool_input.file_path;
  if (!file) return null;

  const { mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op

  for (const id of mine) {
    const meta = readMeta(id);
    if (!meta || meta.status !== 'closed') continue;
    if (resolvePath(file) === resolvePath(specHtmlPath(id))) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'SpecForge: this spec is marked closed (final). Reopen it (set status back) before editing.',
        },
      };
    }
  }
  return null;
}

async function main() {
  const decision = run(parseInput(await readStdin()));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

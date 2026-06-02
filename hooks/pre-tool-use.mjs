#!/usr/bin/env node
// SpecForge — PreToolUse hook.
//
// Closed-spec guard: deny edits to a spec that has been marked `closed` (final).
// Narrowly scoped — only fires when a spec is active AND the edit targets that
// spec's file AND its status is closed. No-op otherwise.
//
// Fail-safe: any error exits 0 (fails open).

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { readStdin, parseInput } from './lib/io.mjs';
import { loadConfig } from '../lib/config.mjs';
import { getActive } from '../lib/active.mjs';
import { resolveSpec } from '../lib/paths.mjs';
import { getStatus } from '../lib/spec.mjs';

async function main() {
  const input = parseInput(await readStdin());
  const file = input.tool_input && input.tool_input.file_path;
  if (!file) return;

  const cwd = input.cwd || process.cwd();
  let specsDir;
  try {
    specsDir = loadConfig(cwd).specsDir;
  } catch {
    return;
  }
  const active = getActive(specsDir);
  if (!active) return;
  const spec = resolveSpec(specsDir, active.specId);
  if (!spec || resolvePath(file) !== resolvePath(spec.file)) return;

  let html = '';
  try {
    html = readFileSync(spec.file, 'utf8');
  } catch {
    return;
  }
  if (getStatus(html).toLowerCase().includes('closed')) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'SpecForge: this spec is marked closed (final). Reopen it (set status back) before editing.',
      },
    }));
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

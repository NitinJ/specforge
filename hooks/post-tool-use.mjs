#!/usr/bin/env node
// SpecForge — PostToolUse hook.
//
// Evidence ledger: while a spec is being implemented, record commits, PR ops,
// test runs, and edits so the Stop hook can detect spec/implementation drift.
// No-op (and cheap) whenever no spec is active.
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { loadConfig } from '../lib/config.mjs';
import { getActive } from '../lib/active.mjs';
import { appendEvent } from '../lib/ledger.mjs';

function classify(input) {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    const resp = input.tool_response || {};
    const out = String(resp.stdout || resp.output || resp || '');
    if (/\bgh\s+pr\s+create\b/.test(cmd)) {
      const m = out.match(/\/pull\/(\d+)/);
      return { kind: 'pr', number: m ? `#${m[1]}` : '' };
    }
    if (/\bgit\s+push\b/.test(cmd)) return { kind: 'push' };
    if (/\bgit\s+commit\b/.test(cmd)) return { kind: 'commit' };
    if (/\b(node\s+--test|npm\s+(run\s+)?test|pytest|jest|vitest|go\s+test)\b/.test(cmd)) return { kind: 'test' };
    return null;
  }
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    return { kind: 'edit', file: ti.file_path || '' };
  }
  return null;
}

async function main() {
  const input = parseInput(await readStdin());
  const cwd = input.cwd || process.cwd();
  let specsDir;
  try {
    specsDir = loadConfig(cwd).specsDir;
  } catch {
    return;
  }
  if (!getActive(specsDir)) return; // only record during implementation
  const ev = classify(input);
  if (ev) appendEvent(specsDir, { ...ev, at: new Date().toISOString() });
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

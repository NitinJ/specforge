#!/usr/bin/env node
// SpecForge — PostToolUse hook (v2, session-aware).
//
// Evidence ledger: while a spec this session owns is being implemented, record
// commits, PR ops, test runs, and edits to that spec's ledger so the Stop hook
// can detect spec/implementation drift. No-op (and cheap) for every session that
// owns no spec, and for owned specs not in the `implementing` state.
//
// Fail-safe: any error exits 0.

import { readStdin, parseInput } from './lib/io.mjs';
import { mineFor } from './lib/session.mjs';
import { readMeta } from '../lib/meta.mjs';
import { appendEvent } from '../lib/store-ledger.mjs';

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

export function run(input, env = process.env) {
  const { mine } = mineFor(env);
  if (!mine.length) return null; // ← idle no-op
  const ev = classify(input);
  if (!ev) return null;
  const at = new Date().toISOString();
  for (const id of mine) {
    const meta = readMeta(id);
    if (meta && meta.status === 'implementing') appendEvent(id, { ...ev, at });
  }
  return null; // PostToolUse never emits a decision
}

async function main() {
  run(parseInput(await readStdin()));
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().then(() => process.exit(0)).catch(() => process.exit(0));

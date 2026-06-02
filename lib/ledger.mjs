// Evidence ledger. The PostToolUse hook records what happened during a turn
// (commits, PR ops, test runs, edits) at <specsDir>/.specforge/ledger.json; the
// Stop hook reads it to detect spec/implementation drift, then clears it.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

function ledgerPath(specsDir) {
  return join(specsDir, '.specforge', 'ledger.json');
}

export function readLedger(specsDir) {
  try {
    const l = JSON.parse(readFileSync(ledgerPath(specsDir), 'utf8'));
    return Array.isArray(l.events) ? l : { events: [] };
  } catch {
    return { events: [] };
  }
}

export function appendEvent(specsDir, event) {
  const l = readLedger(specsDir);
  l.events.push(event);
  const p = ledgerPath(specsDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(l, null, 2));
  return l;
}

export function clearLedger(specsDir) {
  try {
    rmSync(ledgerPath(specsDir));
  } catch {
    /* already gone */
  }
}

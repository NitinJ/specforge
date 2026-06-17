// Evidence ledger for the v2 global store — the per-spec analogue of v1's
// per-project ledger.mjs. The PostToolUse hook records what happened during a
// turn (commits, PR ops, test runs, edits) at
// ~/.specforge/specs/<id>/ledger.json; the Stop hook reads it to detect
// spec/implementation drift, then clears it. Keyed by spec id (not specsDir) so
// two sessions implementing two specs never share a ledger.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { specDir, ledgerPath } from './store-paths.mjs';

export function readLedger(id) {
  try {
    const l = JSON.parse(readFileSync(ledgerPath(id), 'utf8'));
    return Array.isArray(l.events) ? l : { events: [] };
  } catch {
    return { events: [] };
  }
}

export function appendEvent(id, event) {
  const l = readLedger(id);
  l.events.push(event);
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(ledgerPath(id), JSON.stringify(l, null, 2));
  return l;
}

export function clearLedger(id) {
  try {
    rmSync(ledgerPath(id));
  } catch {
    /* already gone */
  }
}

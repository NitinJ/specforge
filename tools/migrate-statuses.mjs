#!/usr/bin/env node
// Collapse the old six-state lifecycle onto draft/approved.
//
//   node tools/migrate-statuses.mjs            # show what would change
//   node tools/migrate-statuses.mjs --confirm  # write it
//
// The lifecycle used to be draft → in_review → approved → implementing → done →
// closed. It is now draft → approved, so every stored status outside those two
// has to land somewhere:
//
//   implementing, done → approved   they were approved once and then built
//   in_review, closed  → draft      never approved, or approved then withdrawn
//
// Then the new rule applies on top: an approved spec carrying an unresolved
// comment goes back to draft, because approval does not survive an open
// objection. That is checked here so the migration cannot leave behind a state
// the running code would refuse to produce.
//
// Writes meta.json and the spec's HTML badge, and preserves `updated` — a status
// migration is not an edit to the document, and bumping it would float every
// touched spec to the top of the recency-sorted index.
//
// Order matters for that: writeSpecHtml re-writes meta.json as a side effect (to
// bump `updated`), so the badge is written FIRST and meta.json last. The other
// way round, the preserved timestamp is overwritten a moment after it is set.

import { readdirSync, writeFileSync } from 'node:fs';
import { specsDir, metaPath } from '../lib/store-paths.mjs';
import { readMeta } from '../lib/meta.mjs';
import { readSpecHtml, writeSpecHtml } from '../lib/store.mjs';
import { setSpecStatus } from '../lib/plan-edit.mjs';
import { loadComments } from '../lib/store-comments.mjs';

const confirm = process.argv.includes('--confirm');

const APPROVED_BEFORE = new Set(['approved', 'implementing', 'done']);

/** Where an old status lands, before the unresolved-comment rule is applied. */
function target(status) {
  return APPROVED_BEFORE.has(String(status).trim()) ? 'approved' : 'draft';
}

let ids;
try {
  ids = readdirSync(specsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
} catch {
  console.error(`no store at ${specsDir()}`);
  process.exit(1);
}

let changed = 0;
for (const id of ids) {
  const meta = readMeta(id);
  if (!meta) continue;
  const from = meta.status || 'draft';
  let to = target(from);
  let note = '';
  if (to === 'approved') {
    const open = loadComments(id).threads.filter((t) => t.state !== 'resolved').length;
    if (open) { to = 'draft'; note = ` (${open} unresolved comment${open === 1 ? '' : 's'})`; }
  }
  if (to === from) continue;
  changed += 1;
  console.log(`${confirm ? 'set  ' : 'would set'} ${id}  ${from} → ${to}${note}`);
  console.log(`  ${meta.title || '(untitled)'}`);
  if (!confirm) continue;
  try {
    writeSpecHtml(id, setSpecStatus(readSpecHtml(id), to));
  } catch {
    /* spec.html may be unreadable; meta is the source of truth */
  }
  writeFileSync(metaPath(id), JSON.stringify({ ...meta, status: to }, null, 2));
}

console.log(changed
  ? `\n${changed} spec${changed === 1 ? '' : 's'}${confirm ? ' migrated' : ' would change; re-run with --confirm'}`
  : '\nnothing to migrate');

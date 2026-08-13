#!/usr/bin/env node
// Repair spec titles that were stored HTML-escaped.
//
//   node tools/repair-titles.mjs            # show what would change
//   node tools/repair-titles.mjs --confirm  # write it
//
// getTitle used to strip tags without decoding entities, so a title containing
// `&`, `<` or a quote reached meta.json still escaped, and every renderer then
// escaped it again. The reader is fixed; this repairs what it already wrote.
//
// Only touches titles that decode to something different, so it is safe to run
// repeatedly and on a store that was never affected.

import { readdirSync, writeFileSync } from 'node:fs';
import { specsDir, metaPath } from '../lib/store-paths.mjs';
import { readMeta } from '../lib/meta.mjs';

const confirm = process.argv.includes('--confirm');

/** The same decode getTitle now applies, with &amp; last. */
function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

let ids = [];
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
  if (!meta || typeof meta.title !== 'string') continue;
  const fixed = decode(meta.title);
  if (fixed === meta.title) continue;
  changed += 1;
  console.log(`${confirm ? 'fixing ' : 'would fix'} ${id}`);
  console.log(`  was: ${meta.title}`);
  console.log(`  now: ${fixed}`);
  // Written directly rather than through writeMeta, which stamps `updated` on
  // every call. Bumping it would float every repaired spec to the top of a
  // recency-sorted index for a change nobody made to the document.
  if (confirm) writeFileSync(metaPath(id), JSON.stringify({ ...meta, title: fixed }, null, 2));
}

console.log(changed
  ? `\n${changed} spec${changed === 1 ? '' : 's'}${confirm ? ' repaired' : ' would change; re-run with --confirm'}`
  : '\nnothing to repair');

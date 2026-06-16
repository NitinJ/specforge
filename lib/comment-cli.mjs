#!/usr/bin/env node
// Agent-side comment CLI. The public HTTP API is human-only, so the review-spec
// skill writes claude replies and clears batches through this CLI (atomic via the
// store lib).
//
//   reply <specsDir> <specId> <threadId> --body-file <path> [--edited]
//   reply <specsDir> <specId> <threadId> <inline body…>
//   done  <specsDir> <specId> <batchId>

import { readFileSync } from 'node:fs';
import { loadStore, saveStore, addComment } from './comments.mjs';
import { markBatchDone } from './inbox.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const [cmd, specsDir, specId, target, ...rest] = process.argv.slice(2);

if (cmd === 'reply') {
  if (!specsDir || !specId || !target) fail('usage: reply <specsDir> <specId> <threadId> (--body-file <p> | <body…>) [--edited]');
  const edited = rest.includes('--edited');
  const fileIdx = rest.indexOf('--body-file');
  let body;
  if (fileIdx !== -1) {
    body = readFileSync(rest[fileIdx + 1], 'utf8').trim();
  } else {
    body = rest.filter((a) => a !== '--edited').join(' ').trim();
  }
  if (!body) fail('reply: empty body');
  const store = loadStore(specsDir, specId);
  addComment(store, target, { body, author: 'claude', editedSpec: edited });
  saveStore(specsDir, store);
  console.log(`replied to ${target}`);
} else if (cmd === 'done') {
  if (!specsDir || !specId || !target) fail('usage: done <specsDir> <specId> <batchId>');
  const ok = markBatchDone(specsDir, specId, target);
  console.log(ok ? `batch done: ${target}` : `batch not found: ${target}`);
} else {
  fail('usage: comment-cli.mjs <reply|done> …');
}

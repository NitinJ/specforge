#!/usr/bin/env node
// Agent-side comment CLI. The public HTTP API is human-only, so the review-spec
// skill writes claude replies and clears batches through this CLI (atomic via the
// store lib).
//
//   reply <specsDir> <specId> <threadId> --body-file <path> [--edited]
//   reply <specsDir> <specId> <threadId> <inline body…>
//   done  <specsDir> <specId> <batchId>
//   await <specsDir> <specId> [timeoutMs]   # long-poll for the next batch

import { readFileSync } from 'node:fs';
import { loadStore, saveStore, addComment } from './comments.mjs';
import { markBatchDone } from './inbox.mjs';
import { readServerState } from './server-state.mjs';

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
} else if (cmd === 'await') {
  // Long-poll the running review server for the next batch. Prints the batch
  // JSON, or `empty` on timeout. Exits non-zero (no crash) when no server is
  // running, so a review loop can detect that and stop.
  if (!specsDir || !specId) fail('usage: await <specsDir> <specId> [timeoutMs]');
  const timeoutMs = Number(target) > 0 ? Number(target) : 25000;
  const st = readServerState(specsDir);
  if (!st || !st.port) {
    console.error(`await: no review server running for ${specsDir}`);
    process.exit(3);
  }
  try {
    const url = `http://127.0.0.1:${st.port}/api/spec/${encodeURIComponent(specId)}/await?timeout=${timeoutMs}`;
    const r = await fetch(url);
    if (!r.ok) { // 4xx/5xx (e.g. unknown spec) must surface, not look like a timeout
      console.error(`await: server returned ${r.status}`);
      process.exit(3);
    }
    const data = await r.json();
    console.log(data && data.batch ? JSON.stringify(data.batch) : 'empty');
  } catch (e) {
    console.error(`await: ${e && e.message ? e.message : e}`);
    process.exit(3);
  }
} else {
  fail('usage: comment-cli.mjs <reply|done|await> …');
}

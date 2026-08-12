#!/usr/bin/env node
// End-to-end check of a published spec, through the real tunnel.
//
//   node tools/e2e-gateway.mjs <publicUrl> <specId>
//
// Exercises the journeys in spec 0c0a9bcb4a §15 that only a real edge can prove:
// a reviewer loads the page, comments, mentions @agent, submits, and the batch
// lands in the owner's inbox on this machine.

import { listPendingForSpec } from '../lib/store-inbox.mjs';
import { loadComments } from '../lib/store-comments.mjs';

const [, , publicUrl, specId] = process.argv;
if (!publicUrl || !specId) {
  console.error('usage: node tools/e2e-gateway.mjs <publicUrl> <specId>');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const origin = new URL(publicUrl).origin;

// 1. The page loads, and it is the right spec.
const page = await fetch(publicUrl);
const html = await page.text();
check('the published page loads', page.status === 200, `HTTP ${page.status}`);
check('it carries the poll transport', /"transport":"poll"/.test(html));
check('its API base carries the token', html.includes(`${new URL(publicUrl).pathname}/api`));

// 2. Nothing else on the origin is reachable.
for (const path of ['/', `/spec/${specId}`, '/api/shares', `/api/spec/${specId}/meta`]) {
  const r = await fetch(`${origin}${path}`);
  check(`${path} is not exposed`, r.status === 404, `HTTP ${r.status}`);
}

// 3. A reviewer comments and mentions the agent.
const before = loadComments(specId).threads.length;
const create = await fetch(`${publicUrl}/api/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    body: '@agent does this hold at the edge?',
    author: 'lavee',
    anchor: { block: { index: 1, tag: 'H1', text: 'scratch' } },
  }),
});
check('a reviewer can comment', create.status === 201, `HTTP ${create.status}`);

const after = loadComments(specId).threads;
check('the comment reached the owner store', after.length === before + 1);
check('it kept the reviewer name', after.at(-1).comments[0].author === 'lavee');

// 4. Submitting reaches the owner's inbox, which is where the agent picks it up.
const pendingBefore = listPendingForSpec(specId).length;
const submit = await fetch(`${publicUrl}/api/comments/submit`, { method: 'POST' });
check('the reviewer can submit to the agent', submit.status === 201, `HTTP ${submit.status}`);
check('the batch is in the owner inbox', listPendingForSpec(specId).length === pendingBefore + 1);

// 5. Polling reports movement, which is what the page reloads on.
const state = await (await fetch(`${publicUrl}/api/state`)).json();
check('the poll endpoint reports mtimes', state.spec > 0 && state.comments > 0);

console.log(failures ? `\n${failures} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

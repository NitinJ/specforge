#!/usr/bin/env node
// Stage 2 end-to-end: publish a real spec through a real cloudflared tunnel,
// then check from the public side that the one spec is served and nothing else
// is reachable.
//
// usage: e2e-specforge-share.mjs <specId>

import { createPublications } from '/home/nitin/workspace/specforge/lib/publications.mjs';

const specId = process.argv[2];
if (!specId) { console.error('usage: e2e-specforge-share.mjs <specId>'); process.exit(2); }

const pubs = createPublications();
console.log('publishing', specId, '...');
const rec = await pubs.share(specId);
console.log('published at', rec.url, '(local port', rec.port + ')');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000); // let the edge route

let failures = 0;
async function check(label, path, want) {
  let status = 'ERR';
  try {
    const r = await fetch(rec.url + path, { redirect: 'manual' });
    status = r.status;
  } catch (e) {
    status = 'ERR ' + e.message;
  }
  const ok = status === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(42)} ${path.padEnd(34)} ${status} (want ${want})`);
}

console.log('\n--- the one spec is served ---');
await check('the spec itself', '/', 200);
await check('client assets', '/public/review.js', 200);
await check('comments', '/api/comments', 200);
await check('poll state', '/api/state', 200);

console.log('\n--- nothing else is reachable ---');
await check('the daemon index', '/index.html', 404);
await check('this spec by id', `/spec/${specId}`, 404);
await check('this spec API by id', `/api/spec/${specId}/comments`, 404);
await check('another spec', '/spec/da5ef14062', 404);
await check('store-wide prefs', '/api/prefs', 404);
await check('healthz', '/healthz', 404);

// The route whose absence matters most.
let delStatus = 'ERR';
try {
  delStatus = (await fetch(`${rec.url}/api/spec/${specId}`, { method: 'DELETE' })).status;
} catch (e) { delStatus = 'ERR ' + e.message; }
const delOk = delStatus === 404;
if (!delOk) failures++;
console.log(`${delOk ? 'ok  ' : 'FAIL'} ${'DELETE the spec'.padEnd(42)} ${('/api/spec/' + specId).padEnd(34)} ${delStatus} (want 404)`);

console.log('\n--- a reviewer can comment from the public side ---');
const created = await fetch(`${rec.url}/api/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    anchor: { block: { index: 0, tag: 'H1', text: 'e2e probe' } },
    body: 'left from the public side by the stage 2 e2e',
    author: 'e2e-reviewer',
  }),
});
console.log(`comment POST -> ${created.status}`);
if (created.status !== 201) failures++;
else {
  const { thread } = await created.json();
  console.log(`  stored as author=${thread.comments[0].author} kind=${thread.comments[0].kind}`);
  if (thread.comments[0].author !== 'e2e-reviewer' || thread.comments[0].kind !== 'human') failures++;
}

console.log('\nunpublishing...');
await pubs.unshare(specId);
await sleep(2000);
// A revoked tunnel does not refuse the connection: Cloudflare still answers the
// hostname and serves its own error page. What must be gone is the spec.
let after;
try {
  const r = await fetch(rec.url + '/', { signal: AbortSignal.timeout(15000) });
  const body = await r.text();
  const servesSpec = r.status === 200 && !/cloudflare/i.test(body);
  after = `status ${r.status}, serves the spec: ${servesSpec}`;
  if (servesSpec) failures++;
} catch (e) {
  after = `connection refused (${e.message})`;
}
console.log('after unshare:', after);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);

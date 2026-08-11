#!/usr/bin/env node
// Prove the share pill detects a link that no longer serves.
//
// Simulates the real failure: a daemon killed outright leaves its share record
// and its cloudflared child behind, while the listener they point at is gone.
// The URL then answers 502, and a pill reading "Shared" over that would lie.
//
// Reports what GET /meta says about the share, which is what the pill renders.
//
// usage: node tools/check-share-down.mjs <specId>

import { readShare } from '../lib/store-share.mjs';

const specId = process.argv[2];
if (!specId) { console.error('usage: check-share-down.mjs <specId>'); process.exit(2); }

const BASE = process.env.SF_BASE || 'http://127.0.0.1:4180';

const rec = readShare(specId);
console.log(`record on disk: ${rec ? rec.url : '(none)'}`);

const meta = await (await fetch(`${BASE}/api/spec/${specId}/meta`)).json();
console.log(`meta.share    : ${JSON.stringify(meta.share)}`);

if (!meta.share) {
  console.log('\nnothing published; publish first, then kill -9 the daemon and re-run');
  process.exit(0);
}

console.log(`\npill would read: ${meta.share.live ? 'Shared + Copy' : 'Link down + Regenerate'}`);

// And what the public URL actually does, which is the claim being checked.
try {
  const r = await fetch(meta.share.url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
  console.log(`public url     : HTTP ${r.status}`);
  const serves = r.status === 200;
  const agrees = serves === !!meta.share.live;
  console.log(agrees
    ? `\nok  the pill agrees with the link (${serves ? 'serving' : 'not serving'})`
    : `\nFAIL the pill says live=${meta.share.live} but the link returns ${r.status}`);
  process.exit(agrees ? 0 : 1);
} catch (e) {
  console.log(`public url     : unreachable (${e.message})`);
  console.log(meta.share.live ? '\nFAIL the pill claims live over an unreachable link' : '\nok  the pill does not claim live');
  process.exit(meta.share.live ? 1 : 0);
}

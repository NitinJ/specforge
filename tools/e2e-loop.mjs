#!/usr/bin/env node
// The delegated-work loop, end to end, through a real cloudflared tunnel and a
// real browser.
//
// Publishes a spec, drives a headless browser at the public URL as a reviewer
// who has never seen SpecForge, and checks the whole path: the naming dialog,
// a discussion comment that must NOT queue work, an @agent comment that must,
// the submit, the batch file the owner's session picks up, and the agent's
// reply appearing back on the reviewer's page.
//
// Needs cloudflared on PATH, outbound network, and a Playwright chromium. Not
// part of the test suite: it is the stage's acceptance check, run by hand.
//
// usage: node tools/e2e-loop.mjs <specId>

import { createPublications } from '../lib/publications.mjs';
import { loadComments, mutateComments, addComment } from '../lib/store-comments.mjs';
import { listPendingForSpec, markBatchDone } from '../lib/store-inbox.mjs';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pw from 'playwright';

const { chromium } = pw;

const specId = process.argv[2];
if (!specId) { console.error('usage: e2e-loop.mjs <specId>'); process.exit(2); }

// Everything this run writes into the store, so it can put it back. The spec is
// a real one with real review history: leaving synthetic threads and a
// completed batch behind would corrupt it.
const createdThreads = new Set();
let ourBatchId = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

const pubs = createPublications();
console.log(`publishing ${specId} ...`);
const rec = await pubs.share(specId);
console.log(`published at ${rec.url}\n`);
await sleep(4000); // let the edge route

/**
 * Any chromium under Playwright's browser cache, newest revision first.
 *
 * Playwright's default resolution wants the exact revision its own version
 * pins, which is often not the one installed. Rather than hard-coding a path
 * that works on one machine, look for whatever is actually there.
 */
function discoverChromium() {
  const root = join(homedir(), '.cache', 'ms-playwright');
  let dirs;
  try {
    dirs = readdirSync(root).filter((d) => /^chromium/.test(d));
  } catch {
    return [];
  }
  const rev = (d) => Number((/-(\d+)$/.exec(d) || [, 0])[1]);
  return dirs.sort((a, b) => rev(b) - rev(a)).flatMap((d) => [
    join(root, d, 'chrome-linux64', 'chrome'),
    join(root, d, 'chrome-linux', 'chrome'),
    join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
  ]).filter((p) => existsSync(p));
}

// SF_CHROMIUM wins, then Playwright's own resolution, then whatever is actually
// installed in its cache.
const candidates = [
  ...(process.env.SF_CHROMIUM ? [process.env.SF_CHROMIUM] : []),
  null, // Playwright's default
  ...discoverChromium(),
];
let browser = null;
let lastErr = null;
for (const exe of candidates) {
  try {
    browser = await chromium.launch(exe ? { headless: true, executablePath: exe } : { headless: true });
    if (exe) console.log(`using chromium at ${exe}`);
    break;
  } catch (e) {
    lastErr = e;
  }
}
if (!browser) {
  console.error(`cannot launch chromium: ${lastErr && lastErr.message}\n` +
    'Install one with `npx playwright install chromium`, or point SF_CHROMIUM at an existing binary.');
  await pubs.unshare(specId);
  process.exit(2);
}
const page = await browser.newPage();
let threadCountBefore = loadComments(specId).threads.length;

try {
  // A reviewer opening the link for the first time.
  await page.goto(rec.url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const dlg = await page.$('#sf-welcome');
  check(!!dlg, 'a first-time reviewer is greeted and asked for a name');
  if (dlg) {
    const text = await page.textContent('#sf-welcome');
    check(/@agent/.test(text), 'the dialog explains what makes a comment agent work');
    await page.fill('#sf-welcome-name', 'agent');
    await page.click('.sf-welcome-go');
    const err = await page.textContent('.sf-welcome-err');
    check(/reserved/i.test(err || ''), 'a reserved name is refused before any comment is written');
    await page.fill('#sf-welcome-name', 'lavee-e2e');
    await page.click('.sf-welcome-go');
    await page.waitForTimeout(500);
    check(!(await page.$('#sf-welcome')), 'naming yourself dismisses it');
  }

  // Comment 1: discussion. Must not queue anything.
  async function commentOnFirstBlock(body) {
    const before = new Set(loadComments(specId).threads.map((t) => t.id));
    await page.click('main p, p');
    await page.waitForTimeout(600);
    const ta = await page.$('#sf-rail textarea');
    if (!ta) throw new Error('no composer opened');
    await ta.fill(body);
    await page.click('#sf-rail .sf-primary');
    await page.waitForTimeout(1200);
    for (const t of loadComments(specId).threads) {
      if (!before.has(t.id)) createdThreads.add(t.id);
    }
  }

  await commentOnFirstBlock('e2e: why is this bounded at 40 bits?');
  const afterDiscussion = loadComments(specId).threads;
  check(afterDiscussion.length === threadCountBefore + 1, 'the reviewer\'s comment is stored');
  const mine = afterDiscussion[afterDiscussion.length - 1];
  check(mine.comments[0].author === 'lavee-e2e', 'attributed to the name they chose',
    `author=${mine.comments[0].author}`);
  check(mine.comments[0].kind === 'human', 'and recorded as a human comment');

  const pendingAfterDiscussion = listPendingForSpec(specId).length;
  await page.click('.sf-tb-act').catch(() => {});
  await page.waitForTimeout(1200);
  check(listPendingForSpec(specId).length === pendingAfterDiscussion,
    'discussion alone queues no work for the agent');

  // Comment 2: addressed to the agent. This one must queue.
  threadCountBefore = loadComments(specId).threads.length;
  await commentOnFirstBlock('e2e: @agent please widen this to 64 bits');
  const caption = (await page.textContent('.sf-foot-caption').catch(() => '')) || '';
  console.log(`     footer reads: ${JSON.stringify(caption.trim())}`);

  // Identified by what is new, not by position: the spec may already have a
  // pending batch, and replying to someone else's would be worse than failing.
  const batchesBefore = new Set(listPendingForSpec(specId).map((b) => b.batchId));
  await page.click('.sf-tb-act');
  await page.waitForTimeout(2000);
  const pending = listPendingForSpec(specId).filter((b) => !batchesBefore.has(b.batchId));
  check(pending.length > 0, 'submitting queues a batch the owner\'s session will pick up');

  if (pending.length) {
    const batch = pending[0];
    ourBatchId = batch.batchId;
    const threads = loadComments(specId).threads.filter((t) => batch.threadIds.includes(t.id));
    const bodies = threads.flatMap((t) => t.comments.filter((c) => c.batchId === batch.batchId).map((c) => c.body));
    check(bodies.some((b) => /@agent please widen/.test(b)), 'the addressed comment is in the batch');
    check(!bodies.some((b) => /why is this bounded/.test(b)), 'the discussion is not');

    // Stand in for the review flow: the agent replies, then closes the batch.
    const target = threads[0];
    mutateComments(specId, (s) => addComment(s, target.id, {
      body: 'e2e: widened, see §4.', author: 'claude', kind: 'agent',
    }));
    markBatchDone(specId, batch.batchId);

    // The reviewer's page polls, so the reply should arrive without a reload.
    let sawReply = false;
    for (let i = 0; i < 12 && !sawReply; i++) {
      await page.waitForTimeout(1000);
      sawReply = /widened, see/.test((await page.content()) || '');
    }
    check(sawReply, 'the agent\'s reply reaches the reviewer without a reload');
  }
} catch (e) {
  failures++;
  console.log(`FAIL threw: ${e.message}`);
} finally {
  await page.screenshot({ path: '/tmp/e2e-loop.png', fullPage: false }).catch(() => {});
  await browser.close();
  await pubs.unshare(specId);

  // Put the spec back. This runs against a real spec with real review history,
  // so every thread this wrote is removed and the batch it created is cleared
  // rather than left pending or left marked done.
  if (ourBatchId) markBatchDone(specId, ourBatchId);
  if (createdThreads.size) {
    mutateComments(specId, (store) => {
      store.threads = store.threads.filter((t) => !createdThreads.has(t.id));
    });
  }
  console.log(`\nunpublished; removed ${createdThreads.size} thread(s) this run created.`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);

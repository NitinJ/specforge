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
//
// A unique tag per run, because "new since I looked" is not the same as "mine".
// A reviewer commenting while this runs would otherwise be classified as
// harness output and have their thread deleted, which is a far worse outcome
// than leaving a stray test comment behind.
const RUN_TAG = `e2e-${Math.random().toString(36).slice(2, 8)}`;
const REVIEWER = `${RUN_TAG}-reviewer`;
let ourBatchId = null;

/**
 * True only for a thread this run wrote: our own author and a tagged body.
 *
 * This, not a set recorded as we go, is the authority for what belongs to this
 * run. A recorded set misses anything written by a step that then threw, which
 * would strand a synthetic comment in a real spec's history forever; and it can
 * only ever be a superset guess, which is how a reviewer's thread would get
 * deleted. Reading the tag back off the store is both.
 */
const RUN_START = new Date().toISOString();

function isOurs(t) {
  const first = (t.comments || [])[0];
  if (!first || first.author !== REVIEWER) return false;
  if (!String(first.body || '').startsWith(RUN_TAG)) return false;
  // Written since this run began. The tag and the name are both visible on the
  // published page, so another holder of the link could copy them; bounding to
  // this run's own window means they would have to do it while the run is in
  // flight, and the only thread they could get deleted is their own.
  return String(first.createdAt || '') >= RUN_START;
}

/** The ids of every thread in the store that this run wrote. */
function ourThreadIds() {
  return new Set(loadComments(specId).threads.filter(isOurs).map((t) => t.id));
}

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

// A fresh hostname is not resolvable the instant cloudflared reports it, and a
// fixed sleep either wastes time or fails on a slow day. Ask until it answers.
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
  await sleep(2000);
  try {
    const r = await fetch(rec.url, { signal: AbortSignal.timeout(8000) });
    ready = r.status === 200;
  } catch { /* DNS or edge not ready yet */ }
}
if (!ready) {
  console.error('the published URL never answered; the tunnel or DNS did not come up');
  await pubs.unshare(specId);
  process.exit(2);
}

/**
 * Any chromium under Playwright's browser cache, newest revision first.
 *
 * Playwright's default resolution wants the exact revision its own version
 * pins, which is often not the one installed. Rather than hard-coding a path
 * that works on one machine, look for whatever is actually there.
 */
function discoverChromium() {
  // Where Playwright keeps browsers on each platform, plus the override it
  // honours. Searching only Linux's default would fail on the machines least
  // likely to have the pinned revision.
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache', 'ms-playwright'),                    // linux
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),         // macos
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null, // windows
  ].filter(Boolean);

  // Look for the executable by name rather than by path. Playwright's directory
  // layout differs per platform and has changed between versions, so a list of
  // hard-coded paths is a list of guesses that silently excludes a browser that
  // is right there.
  const EXE = new Set([
    'chrome', 'chrome.exe',
    'Chromium', 'Google Chrome for Testing',
    'chrome-headless-shell', 'chrome-headless-shell.exe',
  ]);

  /** Executables under `dir`, to a bounded depth (the deepest layout is macOS's .app). */
  function findExe(dir, depth) {
    if (depth < 0) return [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const found = [];
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) found.push(...findExe(p, depth - 1));
      else if (EXE.has(e.name)) found.push(p);
    }
    return found;
  }

  const rev = (d) => Number((/-(\d+)$/.exec(d) || [, 0])[1]);
  const out = [];
  for (const root of roots) {
    let dirs;
    try {
      dirs = readdirSync(root).filter((d) => /^chromium/.test(d));
    } catch {
      continue; // this platform's cache is not here
    }
    // Newest revision first, and the full build ahead of the headless shell.
    for (const d of dirs.sort((a, b) => rev(b) - rev(a))) {
      const hits = findExe(join(root, d), 5);
      hits.sort((a, b) => Number(/headless/.test(a)) - Number(/headless/.test(b)));
      out.push(...hits);
    }
  }
  return out;
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
// A submit takes every agent-directed thread on the spec, not just this run's.
// If someone else has unanswered work waiting, this run would sweep it into its
// own batch and then close it, consuming their comments without a reply. That
// cannot be unpicked afterwards, so it is refused up front.
{
  const waiting = loadComments(specId).threads.filter((t) =>
    t.state !== 'resolved'
    && !isOurs(t)
    && t.comments.some((c) => c.kind !== 'agent' && !c.batchId && /@agent(?![a-z0-9_-])/i.test(c.body || '')));
  if (waiting.length) {
    console.error(
      `refusing to run: ${waiting.length} thread(s) on this spec are addressed to the agent and not yet submitted.\n` +
      'A submit would sweep them into this run\'s batch, which is then closed, and their comments would never be answered.\n' +
      'Submit or resolve them first, or run against a spec with no pending agent work.');
    await browser.close();
    await pubs.unshare(specId);
    process.exit(2);
  }
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
    await page.fill('#sf-welcome-name', REVIEWER);
    await page.click('.sf-welcome-go');
    await page.waitForTimeout(500);
    check(!(await page.$('#sf-welcome')), 'naming yourself dismisses it');
  }

  // Comment 1: discussion. Must not queue anything.
  async function commentOnFirstBlock(body) {
    await page.click('main p, p');
    await page.waitForTimeout(600);
    const ta = await page.$('#sf-rail textarea');
    if (!ta) throw new Error('no composer opened');
    await ta.fill(body);
    await page.click('#sf-rail .sf-primary');
    await page.waitForTimeout(1200);
  }

  await commentOnFirstBlock(`${RUN_TAG}: why is this bounded at 40 bits?`);
  const afterDiscussion = loadComments(specId).threads;
  check(afterDiscussion.length === threadCountBefore + 1, 'the reviewer\'s comment is stored');
  const mine = afterDiscussion[afterDiscussion.length - 1];
  check(mine.comments[0].author === REVIEWER, 'attributed to the name they chose',
    `author=${mine.comments[0].author}`);
  check(mine.comments[0].kind === 'human', 'and recorded as a human comment');

  await page.click('.sf-tb-act').catch(() => {});
  await page.waitForTimeout(1200);
  // Asked about our own thread rather than the total count, which someone
  // else's concurrent submit would move.
  const queuedOurDiscussion = listPendingForSpec(specId)
    .some((b) => b.threadIds.some((tid) => ourThreadIds().has(tid)));
  check(!queuedOurDiscussion, 'discussion alone queues no work for the agent');

  // Comment 2: addressed to the agent. This one must queue.
  threadCountBefore = loadComments(specId).threads.length;
  await commentOnFirstBlock(`${RUN_TAG}: @agent please widen this to 64 bits`);
  const caption = (await page.textContent('.sf-foot-caption').catch(() => '')) || '';
  console.log(`     footer reads: ${JSON.stringify(caption.trim())}`);

  // Identified by carrying one of this run's own threads, not by position and
  // not merely by being new. Another reviewer submitting at the same moment
  // also produces a new batch, and replying to and closing theirs would be
  // worse than failing outright.
  const batchesBefore = new Set(listPendingForSpec(specId).map((b) => b.batchId));
  await page.click('.sf-tb-act');
  await page.waitForTimeout(2000);
  const mineNow = ourThreadIds();
  const pending = listPendingForSpec(specId).filter((b) =>
    !batchesBefore.has(b.batchId) && b.threadIds.some((tid) => mineNow.has(tid)));
  check(pending.length > 0, 'submitting queues a batch the owner\'s session will pick up');

  if (pending.length) {
    const batch = pending[0];
    ourBatchId = batch.batchId;
    const threads = loadComments(specId).threads.filter((t) => batch.threadIds.includes(t.id));
    const bodies = threads.flatMap((t) => t.comments.filter((c) => c.batchId === batch.batchId).map((c) => c.body));
    check(bodies.some((b) => /@agent please widen/.test(b)), 'the addressed comment is in the batch');
    check(!bodies.some((b) => /why is this bounded/.test(b)), 'the discussion is not');
    // Guarded again here: a reviewer submitting between the precondition check
    // and this point could still land their thread in our batch, and closing it
    // would consume their work.
    check(batch.threadIds.every((tid) => mineNow.has(tid)),
      'the batch holds only this run\'s work, so closing it consumes nobody else\'s');

    // Stand in for the review flow: the agent replies, then closes the batch.
    // The reply goes to OUR thread, not to threads[0]: a spec with an older
    // unresolved @agent thread submits that one alongside ours, and appending a
    // synthetic reply to a real conversation is the worst thing this could do.
    const target = threads.find(isOurs);
    check(!!target, 'the batch carries this run\'s thread to reply to');
    if (target) {
      mutateComments(specId, (s) => addComment(s, target.id, {
        body: `${RUN_TAG}: widened, see §4.`, author: 'claude', kind: 'agent',
      }));
    }
    // Closed only if every thread in it is ours. A mixed batch is left for the
    // owner's session, because an unanswered reviewer thread disappearing is
    // worse than a batch this run failed to tidy.
    if (batch.threadIds.every((tid) => mineNow.has(tid))) markBatchDone(specId, batch.batchId);

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
  // Batches first, and by tag rather than by ourBatchId. A submit that
  // persisted before that variable was assigned would otherwise be left pending
  // forever, pointing at threads the next step is about to delete.
  const mine = ourThreadIds();
  const pendingNow = listPendingForSpec(specId);
  const ourBatches = pendingNow.filter((b) =>
    (b.batchId === ourBatchId || b.threadIds.some((tid) => mine.has(tid)))
    && b.threadIds.every((tid) => mine.has(tid)));

  // A batch holding someone else's thread as well is left alone, and so are the
  // threads inside it: closing it would consume their unanswered work, and
  // deleting from it would leave the batch pointing at nothing.
  const mixed = pendingNow.filter((b) =>
    b.threadIds.some((tid) => mine.has(tid)) && !b.threadIds.every((tid) => mine.has(tid)));
  const stranded = new Set(mixed.flatMap((b) => b.threadIds));
  if (mixed.length) {
    console.log(`left ${mixed.length} mixed batch(es) pending: they also carry someone else's work`);
  }

  // Threads first, then batches. Interrupted between the two, this leaves a
  // pending batch naming threads that are gone: visible, and the owner's
  // session finds nothing to do. The other order leaves synthetic comments
  // stamped with a batchId whose inbox file no longer exists, which is
  // invisible and permanent.
  let removed = 0;
  mutateComments(specId, (store) => {
    const before = store.threads.length;
    store.threads = store.threads.filter((t) => !isOurs(t) || stranded.has(t.id));
    removed = before - store.threads.length;
  });
  for (const b of ourBatches) markBatchDone(specId, b.batchId);
  console.log(`\nunpublished; removed ${removed} thread(s) and ${ourBatches.length} batch(es) this run created.`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);

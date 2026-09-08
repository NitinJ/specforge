// End-to-end tests for the review layer in a real browser. These cover what
// jsdom cannot: layout (the SpecForge launcher menu is the single floating
// control and is clickable) and the full comment round-trip driven through real
// clicks + the HTTP API. Run with `npm run test:e2e`.
//
// The store, the server and the browser all come from ./harness.mjs. This file
// used to boot them itself through `server/app.mjs` and `lib/paths.mjs`, which
// the v2 store replaced; nothing noticed, because the suite is not part of
// `npm test` and an import error reads as one failing file.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withSpec, needsChrome } from './harness.mjs';
import {
  attach, claimWorker, heartbeat, releaseWorker, setSessionHarness,
} from '../lib/attach.mjs';
import { createThread, mutateComments } from '../lib/store-comments.mjs';
import { listPendingForSpec, submitBatch } from '../lib/store-inbox.mjs';
import { readSpecHtml, writeSpecHtml } from '../lib/store.mjs';
import {
  cmdAside, cmdBatchDone, cmdBatchWorking, cmdComments, cmdReply, cmdReviewWait,
} from '../lib/specforge-cli.mjs';

const CODEX = 'codex-e2e-thread';
const codexDeps = {
  session: CODEX,
  harness: 'codex',
  env: { SPECFORGE_HARNESS: 'codex', CODEX_THREAD_ID: CODEX },
  sleep: async () => {},
};

async function waitForBatch(id) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pending = listPendingForSpec(id);
    if (pending.length) return pending.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no review batch appeared for ${id}`);
}

async function commentAndSubmit(page, selector, body) {
  const block = page.locator(selector).first();
  await block.hover();
  await block.click();
  await page.locator('.sf-bub-compose textarea').fill(body);
  await page.locator('.sf-bub-compose .sf-primary').click();
  await page.waitForFunction(() => /Submit comments/.test(document.querySelector('.sf-tb-act')?.textContent || ''));
  await page.locator('.sf-tb-act').click();
}

test('the launcher is the single floating control, is clickable, and opens the menu with the review rows', needsChrome, async () => {
  await withSpec({}, async ({ page }) => {
    assert.equal(await page.locator('#sf-launcher').count(), 1, 'exactly one launcher');
    assert.equal(await page.locator('#sf-sidebar').count(), 1, 'exactly one sidebar');
    // The spec no longer ships its own theme/width controls — those are gone.
    assert.equal(await page.locator('#themeToggle').count(), 0, 'spec has no theme toggle');
    assert.equal(await page.locator('#sf-toggle, #sf-width, #sf-toc-toggle').count(), 0, 'no retired standalone controls');
    // The review command bar lives as a footer on the sidebar (filter + lifecycle action).
    assert.equal(await page.locator('#sf-sidebar .sf-side-foot .sf-act').count(), 1, 'sidebar footer carries the lifecycle action');

    // The launcher is the top hit-target at its own center (nothing overlaps it).
    const clickable = await page.evaluate(() => {
      const el = document.getElementById('sf-launcher');
      const b = el.getBoundingClientRect();
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return h === el || el.contains(h);
    });
    assert.ok(clickable, 'launcher is the top hit-target at its center');

    // Clicking it opens the popover menu carrying Width + Theme controls.
    assert.equal(await page.locator('#sf-menu.open').count(), 0, 'menu starts closed');
    await page.locator('#sf-launcher').click();
    await page.waitForSelector('#sf-menu.open');
    assert.ok(await page.locator('#sf-menu input[type=range]').count() >= 1, 'menu has the width slider');
    assert.ok(await page.locator('#sf-menu .sf-menu-row', { hasText: 'Theme' }).count() >= 1, 'menu has the Theme row');
  });
});

test('comment round-trip: hover block → click → compose → submit persists and renders', needsChrome, async () => {
  await withSpec({}, async ({ page, base, id }) => {
    const block = page.locator('#overview p').first();
    const blockText = (await block.innerText()).replace(/\s+/g, ' ').trim();

    // Hovering the block highlights it (real layout / hit-testing — jsdom can't).
    await block.hover();
    await page.waitForFunction(() => !!document.querySelector('.sf-hover'));

    // Clicking the block opens the composer for that block — no text selection.
    // The composer is a bubble in the rail; it was a standalone #sf-compose panel
    // when this test was written.
    await block.click();
    await page.locator('.sf-bub-compose textarea').fill('E2E block comment');
    await page.locator('.sf-bub-compose .sf-primary').click();

    // The comment must persist through the HTTP API with a block anchor.
    let threads = [];
    for (let i = 0; i < 20 && threads.length === 0; i++) {
      const res = await fetch(`${base}/api/spec/${id}/comments`);
      threads = (await res.json()).threads || [];
      if (threads.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(threads.length, 1, 'one thread persisted via the API');
    assert.equal(threads[0].anchor.block.tag, 'P', 'anchored to the clicked block');
    assert.equal(threads[0].anchor.block.text, blockText, 'anchor carries the block text');
    // The audience chip defaults to the agent, so the stored body carries the
    // mention that makes this thread part of a review batch.
    assert.equal(threads[0].comments[0].body, '@agent E2E block comment');
    assert.equal(threads[0].comments[0].author, 'human');

    // ...and render in the sidebar, marking the block in the document.
    await page.waitForSelector('.sf-thread', { timeout: 8000 });
    assert.match(await page.locator('.sf-thread').first().innerText(), /E2E block comment/);
    await page.waitForSelector('#overview p.sf-block-mark', { timeout: 8000 });
  });
});

test('Codex active review shows truthful status and completes two browser rounds', needsChrome, async () => {
  await withSpec({ permissions: ['clipboard-read', 'clipboard-write'] }, async ({ page, id }) => {
    attach(id, CODEX);
    setSessionHarness(CODEX, 'codex');

    const live = claimWorker(CODEX, {
      pid: process.pid,
      harness: 'codex',
      mode: 'active-foreground',
      leaseId: 'e2e-live',
    });
    heartbeat(CODEX);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    assert.match(await page.locator('.sf-conn-label').innerText(), /Listening/);

    releaseWorker(CODEX, live.leaseId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    assert.match(await page.locator('.sf-conn-label').innerText(), /Review queued/);
    assert.match(await page.locator('.sf-conn-act').innerText(), /Continue in Codex/);

    await commentAndSubmit(page, '#overview p', 'clarify the first round');
    const first = await waitForBatch(id);
    const delivery1 = await cmdReviewWait({ timeout: 0 }, codexDeps);
    assert.equal(delivery1.work[0].batchId, first.batchId);
    await cmdBatchWorking({ id, batchId: first.batchId });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    assert.match(await page.locator('.sf-conn-label').innerText(), /Reviewing/);
    assert.equal(await page.locator('.sf-conn-act').count(), 0,
      'an in-flight round cannot offer duplicate delivery');
    const firstThread = first.threadIds[0];
    writeSpecHtml(id, readSpecHtml(id).replace(
      '{{ What is this, and why now? The problem and its context. }}',
      'Codex clarified the context in round one.',
    ));
    await cmdReply({
      id,
      tid: firstThread,
      body: 'Clarified the overview.',
      effect: `${first.batchId}:${firstThread}:reply`,
    }, { harness: 'codex' });
    await cmdBatchDone({ id, batchId: first.batchId });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    assert.match(await page.locator('#overview').innerText(), /Codex clarified/);
    assert.match(await page.locator(`.sf-thread[data-tid="${firstThread}"]`).innerText(), /codex/i);

    await commentAndSubmit(page, '#design p', '@visualize map this flow');
    const second = await waitForBatch(id);
    assert.notEqual(second.batchId, first.batchId);
    const delivery2 = await cmdReviewWait({ timeout: 0 }, codexDeps);
    assert.equal(delivery2.work[0].batchId, second.batchId);
    await cmdBatchWorking({ id, batchId: second.batchId });
    const secondThread = second.threadIds[0];
    await cmdAside({
      id,
      section: 'design',
      action: 'visualize',
      body: '<p>Codex drafted the review flow as an aside.</p>',
      thread: secondThread,
      batch: second.batchId,
    });
    await cmdReply({
      id,
      tid: secondThread,
      body: 'Added the requested visualization as an aside.',
      effect: `${second.batchId}:${secondThread}:reply`,
    }, { harness: 'codex' });
    await cmdBatchDone({ id, batchId: second.batchId });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sf-aside-mark');
    assert.equal(await page.locator('.sf-comment .who', { hasText: 'codex' }).count(), 2);
    assert.match(await page.locator('#design').innerText(), /The solution:/,
      'the aside action did not replace the source section');
  });
});

test('a shared-origin Codex round preserves reply-only ownership behavior', needsChrome, async () => {
  await withSpec({}, async ({ page, id }) => {
    attach(id, CODEX);
    setSessionHarness(CODEX, 'codex');
    let thread;
    mutateComments(id, (store) => {
      thread = createThread(store, {
        anchor: { block: { index: 0, tag: 'P', text: 'Shared review' } },
        body: '@agent explain this decision',
        author: 'reviewer',
      });
    });
    const batch = submitBatch(id, new Date().toISOString(), { origin: 'share' });
    const before = readSpecHtml(id);
    const delivery = await cmdReviewWait({ timeout: 0 }, codexDeps);
    assert.equal(delivery.kind, 'review');
    const context = await cmdComments({ id });
    assert.equal(context.pending[0].origin, 'share', 'the ownership boundary reaches the shared skill');
    await cmdBatchWorking({ id, batchId: batch.batchId });
    await cmdReply({
      id,
      tid: thread.id,
      body: 'The decision keeps ownership with the publisher.',
      effect: `${batch.batchId}:${thread.id}:reply`,
    }, { harness: 'codex' });
    await cmdBatchDone({ id, batchId: batch.batchId });
    assert.equal(readSpecHtml(id), before, 'shared-origin review replies without editing the owner copy');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    assert.match(await page.locator(`.sf-thread[data-tid="${thread.id}"]`).innerText(), /codex/i);
  });
});

test('daemon loss reports the failed write and keeps the browser draft recoverable', needsChrome, async () => {
  await withSpec({}, async ({ page, stopDaemon }) => {
    const block = page.locator('#overview p').first();
    await block.click();
    const draft = page.locator('.sf-bub-compose textarea');
    await draft.fill('keep this draft through daemon loss');
    await stopDaemon();
    await page.locator('.sf-bub-compose .sf-primary').click();
    await page.waitForSelector('.sfui-snack.err');
    assert.match(await page.locator('.sfui-snack.err').innerText(), /Could not add the comment/);
    assert.equal(await draft.inputValue(), 'keep this draft through daemon loss',
      'the failed write leaves the reviewer text in place for retry');
  });
});

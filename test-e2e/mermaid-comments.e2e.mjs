// Commenting on a diagram, and what happens to that comment when the renderer
// is not there.
//
// This is the half of the design that is not about pictures. A diagram's block
// text is the node labels once rendered and the mermaid source when it is not,
// and the block registry identifies a block by its text. So a spec that renders
// on Monday and cannot reach the renderer on Tuesday is the case that decides
// whether the feature is safe to use for review at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseSpec, withSpec, needsChrome } from './harness.mjs';

const FLOWCHART = `<pre data-lang="mermaid"><code>flowchart LR
  A[collector] --&gt; B{queue full?}
  B -- yes --&gt; C[retry queue]</code></pre>`;

function specWith(...pres) {
  // The prose paragraph is given an id because a rendered diagram contains <p>
  // elements of its own (mermaid's labels live in a foreignObject), so
  // `#overview p` would select a node label rather than prose.
  return baseSpec('Diagram comments').replace(
    '<section id="overview" data-sf-section>',
    `<section id="overview" data-sf-section>
     <p id="prose">The collector batches on a 200ms timer.</p>
     ${pres.join('\n')}`,
  );
}

/** Click a block and leave a comment on it through the real composer. */
async function commentOn(page, selector, body) {
  await page.locator(selector).first().click();
  await page.locator('.sf-bub-compose textarea').fill(body);
  await page.locator('.sf-bub-compose .sf-primary').click();
}

const threadsOf = async (base, id) => (await (await fetch(`${base}/api/spec/${id}/comments`)).json()).threads || [];
const registryOf = async (base, id) => (await (await fetch(`${base}/api/spec/${id}/blocks`)).json()).registry;

test('a comment on a diagram anchors to the diagram block', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page, base, id }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await commentOn(page, 'pre[data-sf-mermaid] g.node', 'Is the retry queue bounded?');

    let threads = [];
    for (let i = 0; i < 30 && threads.length === 0; i++) {
      threads = await threadsOf(base, id);
      if (!threads.length) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(threads.length, 1, 'the comment persisted');

    const block = threads[0].anchor.block;
    // Clicking a node inside the SVG anchors to the PRE, because that is the
    // commentable block. Per-node anchoring is deliberately not in v1.
    assert.equal(block.tag, 'PRE', 'anchored to the diagram, not to something inside it');
    assert.match(block.text, /collector/, 'the anchor quotes the rendered labels');
    assert.doesNotMatch(block.text, /flowchart LR/, 'not the source, which is not what is on the page');
  });
});

test('the comment is still on the diagram after a reload', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page, base, id }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await commentOn(page, 'pre[data-sf-mermaid] g.node', 'Bounded?');
    await page.waitForSelector('.sf-bub', { timeout: 15000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await page.waitForSelector('.sf-bub', { timeout: 15000 });

    assert.equal(await page.locator('.sf-bub-orphan').count(), 0, 'not orphaned');
    assert.equal((await threadsOf(base, id)).length, 1, 'and still exactly one thread');
  });
});

test('a load with the renderer unreachable leaves the registry untouched', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page, base, id }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await commentOn(page, 'pre[data-sf-mermaid] g.node', 'Bounded?');
    await page.waitForSelector('.sf-bub', { timeout: 15000 });
    // Let the registry settle from the rendered load before cutting the renderer.
    await page.waitForTimeout(1200);
    const before = await registryOf(base, id);
    assert.ok(before && before.blocks.length, 'the rendered page recorded a registry');

    await page.route('**/public/mermaid.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sf-launcher');
    await page.waitForTimeout(2000);

    // The diagram is source again, which is a different page from the one that
    // was recorded. Recording THIS one would retire the diagram's block id.
    const pre = await page.locator('pre[data-lang="mermaid"]').first().innerText();
    assert.match(pre, /flowchart LR/, 'the reader gets the source');

    const after = await registryOf(base, id);
    assert.deepEqual(after, before, 'the registry is byte-for-byte what it was');
  });
});

test('a thread survives a renderer outage and comes back to its block', needsChrome, async () => {
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page, base, id }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await commentOn(page, 'pre[data-sf-mermaid] g.node', 'Bounded?');
    await page.waitForSelector('.sf-bub', { timeout: 15000 });
    await page.waitForTimeout(1200);

    // Load 2: renderer unreachable.
    await page.route('**/public/mermaid.js', (r) => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sf-bub', { timeout: 20000 });
    assert.equal(await page.locator('.sf-bub-orphan').count(), 0,
      'a thread must not read as deleted because a script did not arrive');

    // Load 3: renderer back.
    await page.unroute('**/public/mermaid.js');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await page.waitForSelector('.sf-bub', { timeout: 20000 });

    assert.equal(await page.locator('.sf-bub-orphan').count(), 0, 'still not orphaned');
    const marked = await page.locator('pre[data-sf-mermaid].sf-block-mark').count();
    assert.equal(marked, 1, 'and the diagram is marked as carrying a comment again');
    assert.equal((await threadsOf(base, id)).length, 1);
  });
});

test('a comment on prose is unaffected by any of this', needsChrome, async () => {
  // The control. 120 of 120 specs in the store carry no diagram, and their
  // behaviour has to be exactly what it was.
  await withSpec({ html: specWith(FLOWCHART) }, async ({ page, base, id }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });
    await commentOn(page, '#prose', 'A note on the prose.');
    await page.waitForSelector('.sf-bub', { timeout: 15000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sf-bub', { timeout: 20000 });
    const threads = await threadsOf(base, id);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].anchor.block.tag, 'P');
    assert.equal(await page.locator('.sf-bub-orphan').count(), 0);
  });
});

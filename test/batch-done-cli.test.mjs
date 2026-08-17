// batch-done end to end, against a real store.
//
// The unit tests cover which gaps are found. This covers what an agent actually
// hits: the command failing, and the message telling it exactly what to run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'specforge-cli.mjs');

const SPEC = `<!doctype html><html data-sf-spec-status="draft"><head><title>T</title></head><body>
<main>
  <h1>Gate</h1>
  <section id="object"><h2>1 · Object</h2><p>A paragraph to act on.</p></section>
</main>
</body></html>`;

/**
 * A store holding one spec, one human comment, and one submitted batch.
 *
 * SPECFORGE_HOME is set in this process too, because the store modules read it
 * at call time and the seeding happens here rather than through the CLI.
 */
async function seed(t, body) {
  const home = mkdtempSync(join(tmpdir(), 'sf-gate-'));
  const prev = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  t.after(() => {
    if (prev === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  const env = { ...process.env, SPECFORGE_HOME: home };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  const src = join(home, 'seed.html');
  writeFileSync(src, SPEC);
  const { id } = JSON.parse(run('import', src, '--title', 'Gate', '--type', 'design'));

  const { mutateComments } = await import('../lib/store-comments.mjs');
  const { createThread } = await import('../lib/comments.mjs');
  const { submitBatch } = await import('../lib/store-inbox.mjs');
  let threadId;
  mutateComments(id, (store) => {
    const t = createThread(store, {
      anchor: { block: { tag: 'P', text: 'A paragraph to act on.', sectionPath: ['object'], bid: 'b2' } },
      body,
      author: 'nitin',
      kind: 'human',
    });
    threadId = t.id;
    return t;
  });
  const batch = submitBatch(id);
  return { id, run, batchId: batch.batchId, threadId };
}

test('batch-done refuses while an aside action has produced no aside', async (t) => {
  const { id, run, batchId } = await seed(t, '@agent @visualize');

  assert.throws(
    () => run('batch-done', id, batchId),
    (e) => {
      const err = String(e.stderr);
      assert.match(err, /produced no aside/, 'says what is wrong');
      assert.match(err, /--section object/, 'and hands back the command with the section already in it');
      assert.match(err, /--block b2/);
      assert.match(err, /--action visualize/);
      assert.match(err, /--force/, 'and names the escape hatch');
      return true;
    },
  );
});

test('--force closes it anyway, for the case the check cannot see', async (t) => {
  // The reader imported or dismissed the draft before the batch was closed.
  const { id, run, batchId } = await seed(t, '@agent @visualize');
  assert.equal(JSON.parse(run('batch-done', id, batchId, '--force')).ok, true);
});

test('batch-done passes once the aside exists', async (t) => {
  const { id, run, batchId, threadId } = await seed(t, '@agent @visualize');
  run('aside', id, '--section', 'object', '--block', 'b2', '--thread', threadId,
    '--batch', batchId, '--action', 'visualize', '--body', '<p>A draft.</p>');
  assert.equal(JSON.parse(run('batch-done', id, batchId)).ok, true);
});

test('a draft answering an earlier batch does not close this one', async (t) => {
  // Same thread, same action, a second ask. The first draft is on the right
  // thread with the right action and still answers something else.
  const { id, run, batchId, threadId } = await seed(t, '@agent @visualize');
  run('aside', id, '--section', 'object', '--block', 'b2', '--thread', threadId,
    '--batch', 'b_earlier', '--action', 'visualize', '--body', '<p>An older draft.</p>');
  assert.throws(() => run('batch-done', id, batchId), (e) => /produced no aside/.test(String(e.stderr)));
});

test('an aside answering a different thread does not close this batch', async (t) => {
  // The section-plus-action check would have passed here. The draft exists on
  // §object and it is a Visualize draft; it just answers something else.
  const { id, run, batchId } = await seed(t, '@agent @visualize');
  run('aside', id, '--section', 'object', '--block', 'b2', '--thread', 'th_someoneelse',
    '--action', 'visualize', '--body', '<p>An older draft.</p>');
  assert.throws(() => run('batch-done', id, batchId), (e) => /produced no aside/.test(String(e.stderr)));
});

test('a batch with no aside action closes as it always did', async (t) => {
  const { id, run, batchId } = await seed(t, '@agent this contradicts §4');
  assert.equal(JSON.parse(run('batch-done', id, batchId)).ok, true);
});

test('an in-place action does not hold the batch open', async (t) => {
  const { id, run, batchId } = await seed(t, '@agent @tighten');
  assert.equal(JSON.parse(run('batch-done', id, batchId)).ok, true);
});

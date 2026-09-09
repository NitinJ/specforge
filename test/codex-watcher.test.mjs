import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { createSpec } from '../lib/store.mjs';
import { attach, workerFor } from '../lib/attach.mjs';
import { createThread, mutateComments } from '../lib/store-comments.mjs';
import { submitBatch, advanceBatchProgress, markBatchDone } from '../lib/store-inbox.mjs';
import { pendingWorkForSession } from '../lib/store-drain.mjs';
import { specConnected } from '../lib/spec-signals.mjs';
import { watchCodex, startCodexWatcher, stopCodexWatcher } from '../lib/codex-watcher.mjs';
import { requestExport } from '../lib/store-export.mjs';
import { requestGenerate } from '../lib/store-generate.mjs';
import { run as stopHook } from '../hooks/stop.mjs';
import { run as promptHook } from '../hooks/user-prompt-submit.mjs';

let home, previous, id;
const session = 'codex-watcher-test';
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-codex-watcher-'));
  previous = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  id = createSpec({ title: 'Watch me', html: '<p>Review this.</p>' });
  attach(id, session);
});
afterEach(() => {
  if (previous === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});
function submit(body) {
  mutateComments(id, (comments) => createThread(comments, {
    anchor: { block: { index: 0, tag: 'P', text: 'Review this.' } },
    body: `@agent ${body}`, author: 'human',
  }));
  return submitBatch(id);
}

for (const harness of ['claude', 'pi']) {
  test(`${harness} lifecycle cannot launch the Codex adapter`, () => {
    startCodexWatcher({ session_id: session }, { SPECFORGE_HARNESS: harness });
    assert.equal(workerFor(session), null);
  });
}

for (const kind of ['generate', 'export']) {
  test(`${kind} delivery uses the shared work reader and survives a worker restart without requeueing`, async () => {
    if (kind === 'generate') requestGenerate(id, 'A new template');
    else requestExport(id);
    let deliveries = 0;
    const deps = {
      deliver: async () => { deliveries++; },
      sleep: async () => { stopCodexWatcher(session); },
    };
    await watchCodex(session, deps);
    await watchCodex(session, deps);
    assert.equal(deliveries, 1);
    assert.equal(pendingWorkForSession(session).kind, kind, 'delivery never claims the request');
  });
}

for (const kind of ['review', 'generate', 'export']) {
  test(`${kind} has one Codex delivery path, even when a hook runs with pending work`, () => {
    if (kind === 'review') submit('one delivery only');
    else if (kind === 'generate') requestGenerate(id, 'Template');
    else requestExport(id);
    const env = { SPECFORGE_HARNESS: 'codex', CODEX_THREAD_ID: session };
    assert.equal(stopHook({}, env), null);
    assert.equal(promptHook({}, env), null);
    assert.equal(pendingWorkForSession(session).kind, kind);
  });
}

test('a new batch does not requeue an older batch that is still working', async () => {
  submit('round A');
  const first = pendingWorkForSession(session).items[0].batchId;
  const messages = [];
  let ticks = 0;
  await watchCodex(session, {
    deliver: async (_sid, reason) => { messages.push(reason); },
    sleep: async () => {
      if (++ticks === 1) {
        advanceBatchProgress(id, first, 'working');
        submit('round B');
      } else stopCodexWatcher(session);
    },
  });
  assert.equal(messages.length, 2);
  assert.ok(messages[0].includes(first));
  assert.ok(!messages[1].includes(first), 'a later submission must not repeat round A');
});

test('an idle watcher delivers two rounds automatically without consuming pending work', async () => {
  let ticks = 0;
  const delivered = [];
  await watchCodex(session, {
    deliver: async (sid, reason) => {
      assert.equal(sid, session);
      assert.match(reason, /review/);
      const work = pendingWorkForSession(session);
      delivered.push(work.items[0].batchId);
      assert.ok(work, 'queueing does not acknowledge the batch');
    },
    sleep: async () => {
      assert.equal(specConnected(id), true);
      if (++ticks === 1) submit('first round');
      if (ticks === 3) {
        assert.equal(delivered.length, 1, 'pending work is not queued twice');
        advanceBatchProgress(id, delivered[0], 'working');
        markBatchDone(id, delivered[0]);
        submit('second round');
      }
      if (ticks === 4) stopCodexWatcher(session);
    },
  });
  assert.equal(delivered.length, 2);
  assert.notEqual(delivered[0], delivered[1]);
  assert.equal(workerFor(session), null);
});

test('duplicate workers exit immediately and failed queue delivery remains retryable', async () => {
  submit('retry me');
  let attempts = 0, ticks = 0;
  await watchCodex(session, {
    deliver: async () => { if (++attempts === 1) throw new Error('queue unavailable'); },
    onError: () => {},
    sleep: async () => {
      await watchCodex(session, {
        deliver: async () => assert.fail('a duplicate worker delivered'),
        sleep: async () => assert.fail('a duplicate worker stayed alive'),
      });
      assert.ok(pendingWorkForSession(session));
      if (++ticks === 2) stopCodexWatcher(session);
    },
  });
  assert.equal(attempts, 2);
});

test('real Stop hooks return while one detached worker delivers a later submission', { timeout: 25_000 }, async () => {
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const log = join(home, 'queued.json');
  writeFileSync(join(bin, 'codex'), `#!${process.execPath}\nimport('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))));\n`, { mode: 0o755 });
  const hook = fileURLToPath(new URL('../hooks/stop.mjs', import.meta.url));
  const env = { ...process.env, SPECFORGE_HARNESS: 'codex', CODEX_THREAD_ID: session,
    PATH: `${bin}${delimiter}${process.env.PATH}` };
  let pid;
  const waitUntil = async (fn) => {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      if (fn()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail('worker did not deliver within one polling interval');
  };
  try {
    for (let i = 0; i < 3; i++) {
      const result = spawnSync(process.execPath, [hook], {
        env, input: JSON.stringify({ session_id: session }), encoding: 'utf8', timeout: 2000,
      });
      assert.equal(result.error, undefined, 'the hook must not wait for its child');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '', 'idle Stop does not block the agent');
    }
    await waitUntil(() => { pid = workerFor(session)?.pid; return !!pid && specConnected(id); });
    submit('submitted after the hook exited');
    await waitUntil(() => {
      try { return JSON.parse(readFileSync(log, 'utf8'))[0] === 'queue'; } catch { return false; }
    });
    const args = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(args.slice(0, 4), ['queue', '--thread', session, '--message']);
    assert.match(args[4], /review/);
    assert.equal(workerFor(session).pid, pid, 'repeated hooks reuse the worker');
    assert.ok(pendingWorkForSession(session), 'the real CLI adapter does not consume the batch');
  } finally {
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ } }
  }
});

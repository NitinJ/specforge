import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSpec } from '../lib/store.mjs';
import { attach, claimWorker, heartbeat, setSessionHarness, watcherAlive, workerFor } from '../lib/attach.mjs';
import { readMeta } from '../lib/meta.mjs';
import { requestExport } from '../lib/store-export.mjs';
import { requestGenerate } from '../lib/store-generate.mjs';
import { createThread, mutateComments } from '../lib/store-comments.mjs';
import { submitBatch } from '../lib/store-inbox.mjs';
import { specConnected, specDelivery } from '../lib/spec-signals.mjs';
import { cmdReviewWait } from '../lib/specforge-cli.mjs';
import { run as stop } from '../hooks/stop.mjs';
import { run as prompt } from '../hooks/user-prompt-submit.mjs';
import { run as start } from '../hooks/session-start.mjs';

let home, previousHome, id;
const session = 'codex-idle';
const env = { SPECFORGE_HARNESS: 'codex', CODEX_THREAD_ID: session };
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-codex-idle-'));
  previousHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  id = createSpec({ title: 'Idle review', html: '<h1>Idle review</h1>' });
  attach(id, session);
  setSessionHarness(session, 'codex');
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

// Exercise the actual CLI, including the legacy alias used by older skills.
for (const command of ['review-wait', 'wait-batch']) {
  test(`idle Codex ${command} exits without a polling terminal`, () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../lib/specforge-cli.mjs', import.meta.url)), command,
    ], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 2000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ready: false, pending: [], reason: 'next-turn' });
    assert.equal(workerFor(session), null);
  });
}

test('idle Codex can settle repeatedly without a watcher instruction', () => {
  assert.equal(stop({}, env), null);
  assert.equal(stop({}, env), null);
  const guidance = start({}, env).hookSpecificOutput.additionalContext;
  assert.match(guidance, /background watcher.*automatically/i);
  assert.doesNotMatch(guidance, /foreground|leave.*active|run it again/i);
});

for (const kind of ['review', 'generate', 'export']) {
  test(`Codex hooks leave ${kind} delivery to the host-owned watcher`, async () => {
    assert.equal(stop({}, env), null);
    if (kind === 'review') {
      mutateComments(id, (comments) => createThread(comments, {
        anchor: { block: { index: 0, tag: 'H1', text: 'Idle review' } },
        body: '@agent explain this', author: 'human',
      }));
      submitBatch(id);
    } else if (kind === 'generate') requestGenerate(id, 'A test template');
    else requestExport(id);
    const first = (await cmdReviewWait({}, { session, harness: 'codex', env })).reason;
    assert.match(first, new RegExp(kind));
    assert.equal((await cmdReviewWait({}, { session, harness: 'codex', env })).reason, first,
      'missed delivery is recoverable until the skill acknowledges it');
    assert.equal(prompt({}, env), null);
    assert.equal(stop({}, env), null);
    assert.doesNotMatch(first, /foreground|leave.*active|run it again/i);
  });
}

test('a Codex check ignores a legacy same-PID lease and never sleeps or beats', async () => {
  const legacy = claimWorker(session, { pid: process.pid, harness: 'codex', leaseId: 'legacy' });
  const before = readMeta(id).heartbeat;
  const result = await cmdReviewWait({}, {
    session, harness: 'codex', env,
    sleep: async () => assert.fail('Codex must return instead of polling'),
  });
  assert.equal(result.reason, 'next-turn');
  assert.equal(readMeta(id).heartbeat, before);
  assert.deepEqual(workerFor(session), legacy, 'the check does not claim or replace a worker');
  heartbeat(session);
  assert.equal(watcherAlive(session, () => assert.fail('a Codex PID must not be probed')), false);
  assert.equal(specConnected(id), false);
  assert.deepEqual(specDelivery(id), { state: 'disconnected', mode: null, harness: 'codex' });
});

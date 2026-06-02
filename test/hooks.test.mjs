import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildIndex } from '../lib/paths.mjs';
import { loadStore, saveStore, createThread } from '../lib/comments.mjs';
import { submitBatch } from '../lib/inbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, 'hooks');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

/** A temp project (cwd) whose default specs dir has a spec + a submitted batch. */
function projectWithPendingBatch() {
  const cwd = mkdtempSync(join(tmpdir(), 'sf-proj-'));
  const specsDir = join(cwd, 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, 's-spec.html'), TEMPLATE);
  const id = buildIndex(specsDir)[0].id;
  const store = loadStore(specsDir, id, 's-spec.html');
  createThread(store, { anchor: { sectionId: 'overview', quote: { exact: 'The problem' } }, body: 'q' });
  saveStore(specsDir, store);
  const batch = submitBatch(specsDir, id, 's-spec.html');
  return { cwd, batch };
}

function runHook(script, input) {
  return spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 8000,
  });
}

test('stop hook blocks and routes to review-spec when a batch is pending', () => {
  const { cwd, batch } = projectWithPendingBatch();
  const res = runHook('stop.mjs', { cwd, stop_hook_active: false });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /review-spec/);
  assert.ok(out.reason.includes(batch.batchId));
});

test('stop hook does not re-block when stop_hook_active (loop guard)', () => {
  const { cwd } = projectWithPendingBatch();
  const res = runHook('stop.mjs', { cwd, stop_hook_active: true });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('stop hook is a no-op when nothing is pending', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sf-empty-'));
  const res = runHook('stop.mjs', { cwd, stop_hook_active: false });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('SessionStart hook surfaces pending batches as context', () => {
  const { cwd } = projectWithPendingBatch();
  const res = runHook('session-start.mjs', { cwd });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /review batch/i);
});

test('UserPromptSubmit hook surfaces pending batches as context', () => {
  const { cwd } = projectWithPendingBatch();
  const res = runHook('user-prompt-submit.mjs', { cwd, prompt: 'hi' });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /review batch/i);
});

test('drain hooks are no-ops with no SpecForge state', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sf-empty-'));
  for (const h of ['session-start.mjs', 'user-prompt-submit.mjs']) {
    const res = runHook(h, { cwd });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  }
});

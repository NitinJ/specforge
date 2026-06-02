import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildIndex } from '../lib/paths.mjs';
import { setActive } from '../lib/active.mjs';
import { appendEvent, readLedger } from '../lib/ledger.mjs';
import { setSpecStatus } from '../lib/plan-edit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, 'hooks');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

function project({ status = 'draft', active = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'sf-enf-'));
  const specsDir = join(cwd, 'specs');
  mkdirSync(specsDir, { recursive: true });
  const html = status === 'draft' ? TEMPLATE : setSpecStatus(TEMPLATE, status);
  const file = join(specsDir, 's-spec.html');
  writeFileSync(file, html);
  const id = buildIndex(specsDir)[0].id;
  if (active) setActive(specsDir, { specId: id, specPath: 's-spec.html', stage: '1', task: '1.1' });
  return { cwd, specsDir, id, file };
}
const runHook = (script, input) =>
  spawnSync(process.execPath, [join(HOOKS, script)], { input: JSON.stringify(input), encoding: 'utf8', timeout: 8000 });

test('post-tool-use records gh pr create as a pr event when a spec is active', () => {
  const { cwd, specsDir } = project();
  const res = runHook('post-tool-use.mjs', {
    cwd, tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title x' },
    tool_response: { stdout: 'https://github.com/o/r/pull/42' },
  });
  assert.equal(res.status, 0);
  assert.ok(readLedger(specsDir).events.some((e) => e.kind === 'pr' && e.number === '#42'));
});

test('post-tool-use is a no-op when no spec is active', () => {
  const { cwd, specsDir } = project({ active: false });
  runHook('post-tool-use.mjs', { cwd, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
  assert.deepEqual(readLedger(specsDir).events, []);
});

test('pre-tool-use denies edits to a closed spec, allows otherwise', () => {
  const closed = project({ status: 'closed' });
  const denied = runHook('pre-tool-use.mjs', { cwd: closed.cwd, tool_name: 'Edit', tool_input: { file_path: closed.file } });
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');

  const impl = project({ status: 'implementing' });
  const allowed = runHook('pre-tool-use.mjs', { cwd: impl.cwd, tool_name: 'Edit', tool_input: { file_path: impl.file } });
  assert.equal(allowed.stdout.trim(), '');
});

test('stop hook blocks on PR-recording drift', () => {
  const { cwd, specsDir } = project({ status: 'implementing' });
  appendEvent(specsDir, { kind: 'pr', number: '#42', at: 't' });
  const res = runHook('stop.mjs', { cwd, stop_hook_active: false });
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('#42'));
});

test('stop hook respects the loop guard during enforcement', () => {
  const { cwd, specsDir } = project({ status: 'implementing' });
  appendEvent(specsDir, { kind: 'pr', number: '#42', at: 't' });
  const res = runHook('stop.mjs', { cwd, stop_hook_active: true });
  assert.equal(res.stdout.trim(), '');
});

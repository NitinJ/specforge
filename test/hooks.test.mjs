import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { requestExport } from '../lib/store-export.mjs';
import { run as stopRun } from '../hooks/stop.mjs';
import { run as upsRun } from '../hooks/user-prompt-submit.mjs';
import { run as sessionStartRun } from '../hooks/session-start.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, 'hooks');

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-hooks-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

// --- the gate: a session that owns nothing is an immediate no-op ---

test('hooks no-op when there is no session id', () => {
  assert.equal(stopRun({}, {}), null);
  assert.equal(upsRun({}, {}), null);
  assert.equal(sessionStartRun({}, {}), null);
});

test('hooks no-op when the session owns no specs', () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'sess-orphan' };
  assert.equal(stopRun({}, env), null);
  assert.equal(upsRun({}, env), null);
  assert.equal(sessionStartRun({}, env), null);
});

test('hooks take the session id from the stdin payload when env lacks it', () => {
  // Claude Code sends session_id in every hook payload; the env var is the
  // fallback. A hook context without CLAUDE_CODE_SESSION_ID must still find
  // the session's specs — otherwise heartbeats stop and the lock goes stale
  // under a live session.
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-stdin');
  const out = sessionStartRun({ session_id: 'sess-stdin' }, {});
  assert.ok(out, 'SessionStart acts on the stdin session id');
  assert.match(out.hookSpecificOutput.additionalContext, /1 spec/);
});

test('the stdin session id wins over a conflicting env var', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-stdin');
  const out = sessionStartRun({ session_id: 'sess-stdin' }, { CLAUDE_CODE_SESSION_ID: 'sess-env' });
  assert.ok(out, 'the payload id (authoritative, per-invocation) is preferred');
});

test('SessionStart re-arms the watcher when the (resumed) session owns specs', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const out = sessionStartRun({}, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /wait-batch/);
  assert.match(out.hookSpecificOutput.additionalContext, /1 spec/);
});

// --- heartbeat: the hooks must NOT beat ---
//
// A turn in a window proves the window exists. It says nothing about whether
// anything is listening for comments, which is what the heartbeat is asked. When
// the hooks beat, every spec anyone had opened read as connected for the half
// hour its lock took to go stale, whether or not a watcher was ever armed.

test('Stop does not touch the heartbeat', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const m = readMeta(id);
  m.heartbeat = 1000;
  writeMeta(id, m);
  stopRun({}, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(readMeta(id).heartbeat, 1000, 'only the review watcher beats');
});

test('UserPromptSubmit does not touch the heartbeat', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const m = readMeta(id);
  m.heartbeat = 1000;
  writeMeta(id, m);
  assert.equal(upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
  assert.equal(readMeta(id).heartbeat, 1000);
});

// --- loop guard ---

test('Stop respects the loop guard (stop_hook_active)', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  requestExport(id); // Stop would block on this...
  assert.equal(stopRun({ stop_hook_active: true }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null,
    '...but not on a stop that already followed a stop-hook continuation');
});

// --- subprocess wiring: the script runs end-to-end and the 100ms readStdin
//     ceiling means an unrelated session exits 0 fast with no output (no hang) ---

test('stop.mjs runs as a script and no-ops (exit 0, empty) for a non-spec session', () => {
  const env = { ...process.env, SPECFORGE_HOME: home };
  delete env.CLAUDE_CODE_SESSION_ID;
  const res = spawnSync(process.execPath, [join(HOOKS, 'stop.mjs')], {
    input: JSON.stringify({ stop_hook_active: false }), encoding: 'utf8', timeout: 8000, env,
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

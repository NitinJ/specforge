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
import { appendEvent } from '../lib/store-ledger.mjs';
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

function implementingSpec(session = 'sess-1') {
  const id = createSpec({ title: 'A' });
  attach(id, session);
  const m = readMeta(id);
  m.status = 'implementing';
  writeMeta(id, m);
  return id;
}

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

// --- heartbeat: owned specs get their lock bumped each turn ---

test('Stop bumps heartbeat for the session’s specs', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const m = readMeta(id);
  m.heartbeat = 1000;
  writeMeta(id, m);
  stopRun({}, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.ok(readMeta(id).heartbeat > 1000);
});

test('UserPromptSubmit bumps heartbeat for the session’s specs', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-1');
  const m = readMeta(id);
  m.heartbeat = 1000;
  writeMeta(id, m);
  assert.equal(upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
  assert.ok(readMeta(id).heartbeat > 1000);
});

// --- loop guard ---

test('Stop respects the loop guard (stop_hook_active)', () => {
  const id = implementingSpec();
  appendEvent(id, { kind: 'pr', number: '#42', at: 't' });
  assert.equal(stopRun({ stop_hook_active: true }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
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

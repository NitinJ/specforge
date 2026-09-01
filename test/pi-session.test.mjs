// Pi-port session identity: SPECFORGE_SESSION_ID is the harness-neutral env var
// the Pi extension injects into Bash subprocesses (Pi has no
// CLAUDE_CODE_SESSION_ID). These tests pin the resolution order:
// explicit payload/deps > SPECFORGE_SESSION_ID > CLAUDE_CODE_SESSION_ID.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { createSpec } from '../lib/store.mjs';
import { attach } from '../lib/attach.mjs';
import { cmdList } from '../lib/specforge-cli.mjs';
import { mineFor } from '../hooks/lib/session.mjs';
import { run as sessionStartRun } from '../hooks/session-start.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pi-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('mineFor resolves the session from SPECFORGE_SESSION_ID alone', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-pi');
  const { me, mine } = mineFor({ SPECFORGE_SESSION_ID: 'sess-pi' });
  assert.equal(me, 'sess-pi');
  assert.deepEqual(mine, [id]);
});

test('SPECFORGE_SESSION_ID takes priority over CLAUDE_CODE_SESSION_ID', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-pi');
  const { me } = mineFor({ SPECFORGE_SESSION_ID: 'sess-pi', CLAUDE_CODE_SESSION_ID: 'sess-claude' });
  assert.equal(me, 'sess-pi');
});

test('CLAUDE_CODE_SESSION_ID still resolves when the neutral var is absent', () => {
  const { me } = mineFor({ CLAUDE_CODE_SESSION_ID: 'sess-claude' });
  assert.equal(me, 'sess-claude');
});

test('an explicit payload session id still beats every env var', () => {
  const { me } = mineFor(
    { SPECFORGE_SESSION_ID: 'sess-pi', CLAUDE_CODE_SESSION_ID: 'sess-claude' },
    'sess-explicit',
  );
  assert.equal(me, 'sess-explicit');
});

test('hooks act on SPECFORGE_SESSION_ID', () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-pi');
  const out = sessionStartRun({}, { SPECFORGE_SESSION_ID: 'sess-pi' });
  assert.ok(out, 'SessionStart acts on the Pi-injected env var');
  assert.match(out.hookSpecificOutput.additionalContext, /1 spec/);
});

test('cli: wait-batch without any session env errors naming both vars', () => {
  const env = { ...process.env, SPECFORGE_HOME: home };
  delete env.SPECFORGE_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync('node', [join(ROOT, 'lib', 'specforge-cli.mjs'), 'wait-batch'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /no session id/);
  assert.match(out, /SPECFORGE_SESSION_ID/);
});

test('cli: resolves the session from SPECFORGE_SESSION_ID (no Claude env)', async () => {
  const id = createSpec({ title: 'A' });
  attach(id, 'sess-pi-cli');
  const prev = { s: process.env.SPECFORGE_SESSION_ID, c: process.env.CLAUDE_CODE_SESSION_ID };
  process.env.SPECFORGE_SESSION_ID = 'sess-pi-cli';
  delete process.env.CLAUDE_CODE_SESSION_ID;
  try {
    const { session, rows } = await cmdList();
    assert.equal(session, 'sess-pi-cli');
    assert.deepEqual(rows.map((r) => r.id), [id]);
  } finally {
    if (prev.s === undefined) delete process.env.SPECFORGE_SESSION_ID;
    else process.env.SPECFORGE_SESSION_ID = prev.s;
    if (prev.c !== undefined) process.env.CLAUDE_CODE_SESSION_ID = prev.c;
  }
});

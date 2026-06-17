import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec, specHtmlPath } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { appendEvent, readLedger } from '../lib/store-ledger.mjs';
import { run as preRun } from '../hooks/pre-tool-use.mjs';
import { run as postRun } from '../hooks/post-tool-use.mjs';
import { run as stopRun } from '../hooks/stop.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-enf-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** Create a spec, attach it to a session, set its meta.status. */
function ownedSpec({ status = 'implementing', session = 'sess-1' } = {}) {
  const id = createSpec({ title: 'A' });
  attach(id, session);
  if (status !== 'draft') {
    const m = readMeta(id);
    m.status = status;
    writeMeta(id, m);
  }
  return id;
}

const SID = { CLAUDE_CODE_SESSION_ID: 'sess-1' };

test('PostToolUse records gh pr create as a pr event for an implementing owned spec', () => {
  const id = ownedSpec({ status: 'implementing' });
  postRun({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr create --title x' },
    tool_response: { stdout: 'https://github.com/o/r/pull/42' },
  }, SID);
  assert.ok(readLedger(id).events.some((e) => e.kind === 'pr' && e.number === '#42'));
});

test('PostToolUse is a no-op when the session owns no specs', () => {
  const id = ownedSpec({ status: 'implementing' }); // owned by sess-1
  postRun({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
    { CLAUDE_CODE_SESSION_ID: 'someone-else' });
  assert.deepEqual(readLedger(id).events, []);
});

test('PostToolUse is a no-op for an owned spec that is not implementing', () => {
  const id = ownedSpec({ status: 'draft' });
  postRun({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, SID);
  assert.deepEqual(readLedger(id).events, []);
});

test('PreToolUse denies edits to a closed owned spec, allows otherwise', () => {
  const closed = ownedSpec({ status: 'closed' });
  const denied = preRun({ tool_name: 'Edit', tool_input: { file_path: specHtmlPath(closed) } }, SID);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');

  const impl = ownedSpec({ status: 'implementing', session: 'sess-2' });
  const allowed = preRun({ tool_name: 'Edit', tool_input: { file_path: specHtmlPath(impl) } },
    { CLAUDE_CODE_SESSION_ID: 'sess-2' });
  assert.equal(allowed, null);
});

test('PreToolUse ignores edits to files that are not the owned spec', () => {
  ownedSpec({ status: 'closed' });
  const res = preRun({ tool_name: 'Edit', tool_input: { file_path: '/tmp/unrelated.txt' } }, SID);
  assert.equal(res, null);
});

test('Stop blocks on PR-recording drift for an implementing spec', () => {
  const id = ownedSpec({ status: 'implementing' });
  appendEvent(id, { kind: 'pr', number: '#42', at: 't' });
  const out = stopRun({ stop_hook_active: false }, SID);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('#42'));
});

test('Stop does not enforce drift for a draft (non-implementing) spec', () => {
  const id = ownedSpec({ status: 'draft' });
  appendEvent(id, { kind: 'pr', number: '#42', at: 't' });
  assert.equal(stopRun({ stop_hook_active: false }, SID), null);
});

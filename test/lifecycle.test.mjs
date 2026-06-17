import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSpec, readSpecHtml } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { attach } from '../lib/attach.mjs';
import { setStatus } from '../lib/lifecycle.mjs';
import { cmdStatus } from '../lib/specforge-cli.mjs';
import { implementSignalsForSession } from '../lib/store-drain.mjs';
import { run as stopRun } from '../hooks/stop.mjs';
import { run as upsRun } from '../hooks/user-prompt-submit.mjs';

const BADGE_HTML = '<html data-sf-spec-status="draft"><body>status: <span class="b">draft</span><h1>A</h1></body></html>';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-life-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('setStatus writes meta + the spec HTML badge', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  setStatus(id, 'approved');
  assert.equal(readMeta(id).status, 'approved');
  const html = readSpecHtml(id);
  assert.match(html, /data-sf-spec-status="approved"/);
  assert.match(html, /status: <span[^>]*>approved<\/span>/);
});

test('setStatus rejects an invalid status and an unknown spec', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  assert.throws(() => setStatus(id, 'bogus'), /invalid status/);
  assert.throws(() => setStatus('deadbeef00', 'approved'), /unknown spec/);
});

test('implementing arms the one-shot signal; leaving it clears it', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  setStatus(id, 'implementing');
  assert.equal(readMeta(id).implementSignal, true);
  setStatus(id, 'done');
  assert.equal(readMeta(id).implementSignal, undefined);
});

test('cmdStatus validates and returns the new status', async () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  const r = await cmdStatus({ id, status: 'in_review' });
  assert.deepEqual(r, { ok: true, id, status: 'in_review' });
  await assert.rejects(() => cmdStatus({ id, status: 'nope' }), /invalid status/);
});

test('Stop surfaces the implement nudge once, then clears it', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  attach(id, 'sess-1');
  setStatus(id, 'implementing');
  assert.equal(implementSignalsForSession('sess-1').length, 1);

  const out = stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /approved for implementation/i);
  assert.match(out.reason, /status .*done|status <id> done/i);

  // one-shot: signal cleared, so the next Stop no longer nudges to implement
  assert.equal(implementSignalsForSession('sess-1').length, 0);
  assert.equal(stopRun({ stop_hook_active: false }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
});

test('UserPromptSubmit surfaces the implement nudge as context, once', () => {
  const id = createSpec({ title: 'A', html: BADGE_HTML });
  attach(id, 'sess-1');
  setStatus(id, 'implementing');
  const out = upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' });
  assert.match(out.hookSpecificOutput.additionalContext, /approved for implementation/i);
  assert.equal(upsRun({ prompt: 'hi' }, { CLAUDE_CODE_SESSION_ID: 'sess-1' }), null);
});

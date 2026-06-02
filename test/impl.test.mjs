import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULTS } from '../lib/config.mjs';
import { setActive, getActive, clearActive } from '../lib/active.mjs';
import { appendEvent, readLedger, clearLedger } from '../lib/ledger.mjs';
import { setTaskStatus, setStagePr, setSpecStatus } from '../lib/plan-edit.mjs';
import { checkGate } from '../lib/gate.mjs';
import { computeDrift } from '../lib/enforce.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
const RESOLVED = TEMPLATE.replace('data-sf-q="open"', 'data-sf-q="resolved"');
const CONFIG = { requiredSections: DEFAULTS.requiredSections };
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

test('active marker set/get/clear', () => {
  const dir = tmp('sf-active-');
  setActive(dir, { specId: 's1', specPath: 'x.html', stage: '1', task: '1.1' });
  assert.equal(getActive(dir).specId, 's1');
  clearActive(dir);
  assert.equal(getActive(dir), null);
});

test('ledger append/read/clear', () => {
  const dir = tmp('sf-ledger-');
  appendEvent(dir, { kind: 'commit', at: 't' });
  appendEvent(dir, { kind: 'pr', number: '#9', at: 't' });
  assert.equal(readLedger(dir).events.length, 2);
  clearLedger(dir);
  assert.deepEqual(readLedger(dir).events, []);
});

test('plan-edit: task status, stage PR, spec status', () => {
  let h = setTaskStatus(TEMPLATE, '1.1', 'done');
  assert.match(h, /data-sf-task="1.1" data-sf-status="done"/);
  h = setStagePr(TEMPLATE, '1', '#7');
  assert.match(h, /data-sf-stage="1" data-sf-pr="#7"/);
  h = setSpecStatus(TEMPLATE, 'implementing');
  assert.match(h, /<html[^>]*data-sf-spec-status="implementing"/);
  assert.match(h, /status:\s*<span[^>]*>implementing<\/span>/);
});

test('gate passes a sound spec with resolved questions', () => {
  assert.equal(checkGate(RESOLVED, CONFIG).ok, true);
});

test('gate fails on an unresolved open question', () => {
  const { ok, checks } = checkGate(TEMPLATE, CONFIG);
  assert.equal(ok, false);
  assert.equal(checks.find((c) => c.name === 'open-questions-resolved').ok, false);
});

test('gate fails on a missing required section (via lint)', () => {
  const broken = RESOLVED.replace('id="tradeoffs"', 'id="tradeoffs-x"');
  assert.equal(checkGate(broken, CONFIG).ok, false);
});

test('drift: PR opened but stage PR field stale', () => {
  const { nudges } = computeDrift(TEMPLATE, { stage: '1', task: '1.1' }, { events: [{ kind: 'pr', number: '#42' }] });
  assert.ok(nudges.some((n) => n.includes('#42') && n.includes('stage 1')));
});

test('drift: commit happened but active task still todo', () => {
  const { nudges } = computeDrift(TEMPLATE, { stage: '1', task: '1.1' }, { events: [{ kind: 'commit' }] });
  assert.ok(nudges.some((n) => n.includes('1.1')));
});

test('drift: stage complete but impl-time sections still empty', () => {
  const done = TEMPLATE.replaceAll('data-sf-status="todo"', 'data-sf-status="done"');
  const { nudges } = computeDrift(done, { stage: '1' }, { events: [{ kind: 'edit', file: 'x' }] });
  assert.ok(nudges.some((n) => /Design decisions/i.test(n)));
});

test('drift: no events → no nudges', () => {
  const { nudges } = computeDrift(TEMPLATE, { stage: '1', task: '1.1' }, { events: [] });
  assert.equal(nudges.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  deriveStageStatus,
  computeTracker,
  renderTrackerTable,
  applyTrackerToHtml,
  renderLiveTracker,
  writeTrackerSnapshot,
} from '../lib/tracker.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

test('deriveStageStatus covers the status lattice', () => {
  assert.equal(deriveStageStatus([]), 'todo');
  assert.equal(deriveStageStatus([{ status: 'todo' }, { status: 'todo' }]), 'todo');
  assert.equal(deriveStageStatus([{ status: 'done' }, { status: 'todo' }]), 'in_progress');
  assert.equal(deriveStageStatus([{ status: 'in_progress' }]), 'in_progress');
  assert.equal(deriveStageStatus([{ status: 'done' }, { status: 'deferred' }]), 'done');
  assert.equal(deriveStageStatus([{ status: 'blocked' }, { status: 'done' }]), 'blocked');
});

test('computeTracker reads the plan and counts settled tasks', () => {
  const html = TEMPLATE.replace('data-sf-task="1.1" data-sf-status="todo"', 'data-sf-task="1.1" data-sf-status="done"');
  const { stages } = computeTracker(html);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].total, 2);
  assert.equal(stages[0].done, 1);
  assert.equal(stages[0].status, 'in_progress');
});

test('renderTrackerTable + applyTrackerToHtml splice into #task-tracker', () => {
  const table = renderTrackerTable(computeTracker(TEMPLATE));
  assert.match(table, /<th>Stage<\/th>/);
  const applied = applyTrackerToHtml(TEMPLATE, table);
  // the new table lives inside the task-tracker section
  const section = applied.match(/<section\b[^>]*id="task-tracker"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(section, /<th>Status<\/th>/);
});

test('renderLiveTracker does not mutate other sections', () => {
  const out = renderLiveTracker(TEMPLATE);
  assert.ok(out.includes('id="impl-plan"'));
  assert.ok(out.includes('id="tldr"'));
});

test('writeTrackerSnapshot is idempotent and reflects status changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-track-'));
  const file = join(dir, 'spec.html');
  const html = TEMPLATE.replace('data-sf-task="1.1" data-sf-status="todo"', 'data-sf-task="1.1" data-sf-status="done"');
  writeFileSync(file, html);

  const first = writeTrackerSnapshot(file);
  assert.equal(first.changed, true);
  const after = readFileSync(file, 'utf8');
  const section = after.match(/<section\b[^>]*id="task-tracker"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(section, /in_progress/);
  assert.match(section, /\(1\/2\)/);

  const second = writeTrackerSnapshot(file);
  assert.equal(second.changed, false, 'second write is a no-op');
});

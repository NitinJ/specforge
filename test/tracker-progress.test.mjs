// The tracker's two tables: one row per task, one row per stage.
//
// Both are spliced in at serve time, so what the author typed into the file is
// never what a reader sees. That is why these assert on the rendered output
// rather than on the template: a snapshot that disagrees with the renderer is a
// table nobody has ever looked at.
//
// Asked for on template-impl, threads th_482bd2070a and th_8ce0852230.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import {
  computeTracker, renderTrackerTable, renderStageTable, applyTrackerToHtml,
  renderLiveTracker, TASK_STEPS, STAGE_STEPS,
} from '../lib/tracker.mjs';
import { parsePlan } from '../lib/spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');

/** A plan with the shape the trackers are for: two stages, mixed progress. */
const PLAN = `<section id="impl-plan">
  <ol class="sf-stages">
    <li data-sf-stage="0" data-sf-pr="#12" data-sf-steps="6">
      <ul class="sf-tasks">
        <li data-sf-task="0.1" data-sf-status="done" data-sf-steps="4">a</li>
      </ul>
    </li>
    <li data-sf-stage="1" data-sf-pr="" data-sf-steps="2">
      <ul class="sf-tasks">
        <li data-sf-task="1.1" data-sf-status="done" data-sf-steps="4">b</li>
        <li data-sf-task="1.2" data-sf-status="in_progress" data-sf-steps="1">c</li>
        <li data-sf-task="1.3" data-sf-status="todo">d</li>
      </ul>
    </li>
  </ol>
</section>
<section id="stage-tracker"><table><thead><tr><th>old</th></tr></thead><tbody></tbody></table></section>
<section id="task-tracker"><table><thead><tr><th>old</th></tr></thead><tbody></tbody></table></section>`;

const rows = (table) => table.match(/<tr>(?![\s\S]{0,40}<th>)[\s\S]*?<\/tr>/g) || [];

// --- the data ---------------------------------------------------------------

test('parsePlan carries data-sf-steps for stages and tasks', () => {
  const [stage0, stage1] = parsePlan(PLAN);
  assert.equal(stage0.steps, 6);
  assert.equal(stage1.steps, 2);
  assert.deepEqual(stage1.tasks.map((t) => t.steps), [4, 1, 0]);
});

test('a task with no data-sf-steps reads as zero rather than undefined', () => {
  // Every spec written before this attribute existed is that case, and a table
  // cell saying NaN would be the visible result.
  const [stage] = parsePlan('<section id="impl-plan"><li data-sf-stage="1">'
    + '<li data-sf-task="1.1" data-sf-status="todo">x</li></section>');
  assert.equal(stage.steps, 0);
  assert.equal(stage.tasks[0].steps, 0);
});

test('computeTracker flattens the plan into tasks, in plan order', () => {
  const { tasks } = computeTracker(PLAN);
  assert.deepEqual(tasks.map((t) => t.id), ['0.1', '1.1', '1.2', '1.3']);
  assert.deepEqual(tasks.map((t) => t.steps), [4, 4, 1, 0]);
});

test('computeTracker still reports per-stage counts', () => {
  const { stages } = computeTracker(PLAN);
  assert.deepEqual(stages.map((s) => `${s.done}/${s.total}`), ['1/1', '1/3']);
  assert.deepEqual(stages.map((s) => s.status), ['done', 'in_progress']);
});

// --- the task tracker -------------------------------------------------------

test('the task tracker is one row per task, not one per stage', () => {
  const table = renderTrackerTable(computeTracker(PLAN));
  assert.equal(rows(table).length, 4, 'four tasks, four rows');
});

test('its columns are the task id, its status and its progress', () => {
  // The stage column went: a task id already names its stage, and the ask was
  // for the task number rather than a list of them.
  const table = renderTrackerTable(computeTracker(PLAN));
  const head = table.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.deepEqual(head.match(/<th>(.*?)<\/th>/g), ['<th>Task</th>', '<th>Status</th>', '<th>Progress</th>']);
  assert.doesNotMatch(head, /<th>Stage<\/th>/);
  assert.doesNotMatch(head, /<th>Tasks<\/th>/, 'the comma-joined list is gone');
});

test('status renders in-progress rather than the attribute spelling', () => {
  const table = renderTrackerTable(computeTracker(PLAN));
  assert.match(table, />in-progress</);
  assert.doesNotMatch(table, />in_progress</);
});

test('the bar is sf-progress, not the library\'s own .steps list', () => {
  // `.steps` is a numbered list component. Two definitions of one class in a
  // spec is the state the component library exists to end, and the stamp test
  // catches it only in a template.
  const table = renderTrackerTable(computeTracker(PLAN));
  assert.match(table, /class="sf-progress"/);
  assert.doesNotMatch(table, /class="steps"/);
});

test('progress is four blocks, filled left to right', () => {
  const table = renderTrackerTable(computeTracker(PLAN));
  const [, , inProgress, untouched] = rows(table);
  assert.equal((inProgress.match(/<i\b/g) || []).length, 4, 'always four blocks');
  assert.equal((inProgress.match(/class="on"/g) || []).length, 1, 'one of them filled');
  assert.equal((untouched.match(/class="on"/g) || []).length, 0);
});

test('each block names its step, in the order the human gave them', () => {
  assert.deepEqual(TASK_STEPS, [
    'red-green refactor done', 'code implementation done', 'tests pass', 'committed',
  ]);
  const table = renderTrackerTable(computeTracker(PLAN));
  assert.match(rows(table)[0], /title="red-green refactor done"[\s\S]*title="committed"/);
});

test('a step count past the end of the bar fills it and no further', () => {
  const html = PLAN.replace('data-sf-steps="1"', 'data-sf-steps="9"');
  const table = renderTrackerTable(computeTracker(html));
  const row = rows(table)[2];
  assert.equal((row.match(/<i\b/g) || []).length, 4);
  assert.equal((row.match(/class="on"/g) || []).length, 4);
});

// --- the stage tracker ------------------------------------------------------

test('the stage tracker is one row per stage, with the percentage complete', () => {
  const table = renderStageTable(computeTracker(PLAN));
  const head = table.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.deepEqual(head.match(/<th>(.*?)<\/th>/g), [
    '<th>Stage</th>', '<th>PR</th>', '<th>Status</th>',
    '<th>% tasks complete</th>', '<th>Progress</th>',
  ]);
  const [first, second] = rows(table);
  assert.match(first, />100%</);
  assert.match(second, />33%</, '1 of 3 settled, rounded');
});

test('a stage with no tasks reads 0% rather than dividing by zero', () => {
  const html = '<section id="impl-plan"><li data-sf-stage="1" data-sf-pr=""></li></section>'
    + '<section id="stage-tracker"><table></table></section>';
  assert.match(renderStageTable(computeTracker(html)), />0%</);
});

test('its progress is six blocks, from implemented to PR merged', () => {
  assert.deepEqual(STAGE_STEPS, [
    'implemented', 'tested', 'verified', 'PR open', 'PR fixed', 'PR merged',
  ]);
  const [first, second] = rows(renderStageTable(computeTracker(PLAN)));
  assert.equal((first.match(/<i\b/g) || []).length, 6);
  assert.equal((first.match(/class="on"/g) || []).length, 6, 'stage 0 is merged');
  assert.equal((second.match(/class="on"/g) || []).length, 2);
});

test('the PR cell carries the stage PR, and an em dash when there is none', () => {
  const [first, second] = rows(renderStageTable(computeTracker(PLAN)));
  assert.match(first, /<td>#12<\/td>/);
  assert.match(second, /<td>—<\/td>/);
});

// --- splicing ---------------------------------------------------------------

test('renderLiveTracker fills both sections, each with its own table', () => {
  const out = renderLiveTracker(PLAN);
  const task = out.match(/<section id="task-tracker">([\s\S]*?)<\/section>/)[1];
  const stage = out.match(/<section id="stage-tracker">([\s\S]*?)<\/section>/)[1];
  assert.match(task, /<th>Task<\/th>/);
  assert.match(stage, /<th>% tasks complete<\/th>/);
  assert.doesNotMatch(out, /<th>old<\/th>/, 'both authored snapshots were replaced');
});

test('a spec with no stage tracker section is left as it was', () => {
  // Every impl spec written before §4 existed. The task tracker still updates.
  assert.doesNotMatch(TEMPLATE, /id="stage-tracker"/, 'the fixture is one of them');
  const out = renderLiveTracker(TEMPLATE);
  assert.doesNotMatch(out, /id="stage-tracker"/);
  assert.match(out, /<th>Task<\/th>/);
});

test('applyTrackerToHtml addresses one section at a time', () => {
  const out = applyTrackerToHtml(PLAN, '<table><thead><tr><th>x</th></tr></thead></table>', 'stage-tracker');
  assert.match(out.match(/<section id="stage-tracker">([\s\S]*?)<\/section>/)[1], /<th>x<\/th>/);
  assert.match(out.match(/<section id="task-tracker">([\s\S]*?)<\/section>/)[1], /<th>old<\/th>/,
    'the other one is untouched');
});

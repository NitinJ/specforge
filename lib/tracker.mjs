// Live trackers: derive stage/task state from the structured plan and render it
// as two tables, one row per task and one row per stage. Used both for
// serve-time injection (read-only) and for the on-disk snapshot writer (keeps
// the offline view faithful).
//
// Both tables are spliced over whatever the author typed, so the plan is the
// only place any of this is edited. Status comes from `data-sf-status` as it
// always has; the progress bars come from `data-sf-steps`, a count of completed
// steps set on the task or the stage in the plan.

import { readFileSync, writeFileSync } from 'node:fs';
import { parsePlan } from './spec.mjs';

const SETTLED = new Set(['done', 'deferred', 'dropped']);

/** Derive a stage's status from its tasks' statuses. */
export function deriveStageStatus(tasks) {
  if (!tasks.length) return 'todo';
  if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
  if (tasks.every((t) => SETTLED.has(t.status))) return 'done';
  if (tasks.some((t) => t.status === 'in_progress' || SETTLED.has(t.status))) return 'in_progress';
  return 'todo';
}

/** A task's progress bar, in order. Named by the human who asked for it. */
export const TASK_STEPS = [
  'red-green refactor done', 'code implementation done', 'tests pass', 'committed',
];

/** A stage's progress bar, in order: from written code to a merged PR. */
export const STAGE_STEPS = [
  'implemented', 'tested', 'verified', 'PR open', 'PR fixed', 'PR merged',
];

/**
 * Compute the tracker model from spec HTML.
 * @returns {{stages:{stage:string, pr:string, status:string, taskIds:string[],
 *   done:number, total:number, steps:number}[],
 *   tasks:{id:string, status:string, steps:number}[]}}
 */
export function computeTracker(html) {
  const plan = parsePlan(html);
  const stages = plan.map((s) => {
    const done = s.tasks.filter((t) => SETTLED.has(t.status)).length;
    return {
      stage: s.stage ?? '—',
      pr: s.pr || '—',
      status: deriveStageStatus(s.tasks),
      taskIds: s.tasks.map((t) => t.id),
      done,
      total: s.tasks.length,
      steps: s.steps,
    };
  });
  // Flat and in plan order: the task tracker is a list of tasks, and reading it
  // should follow the plan top to bottom.
  const tasks = plan.flatMap((s) => s.tasks);
  return { stages, tasks };
}

const TAG_CLASS = {
  todo: 'todo', in_progress: 'warn', done: 'done', blocked: 'bad',
  deferred: 'todo', dropped: 'todo',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** The status word as a reader should see it: `in_progress` is an attribute. */
function statusTag(status) {
  const cls = TAG_CLASS[status] || 'todo';
  return `<span class="tag ${cls}">${esc(String(status).replace(/_/g, '-'))}</span>`;
}

/**
 * A progress bar: one block per step, filled left to right.
 *
 * The block count is fixed per table, so a reader compares rows down a column
 * without reading a label. A count past the end fills the bar and stops there,
 * because a bar longer than its neighbours would break that comparison.
 *
 * `sf-progress`, not `steps`: the library already owns `.steps`, a numbered
 * list, and two definitions of one class in a spec is what it exists to prevent.
 */
function renderSteps(done, steps) {
  const n = Math.max(0, Math.min(steps.length, Number(done) || 0));
  const blocks = steps
    .map((label, i) => `<i${i < n ? ' class="on"' : ''} title="${esc(label)}"></i>`)
    .join('');
  return `<span class="sf-progress" aria-label="${n} of ${steps.length} steps done">${blocks}</span>`;
}

function table(head, rows) {
  return [
    '<table>',
    `      <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`,
    '      <tbody>',
    ...rows,
    '      </tbody>',
    '    </table>',
  ].join('\n');
}

/** Render the task tracker: one row per task. */
export function renderTrackerTable(tracker) {
  const rows = tracker.tasks.map((t) =>
    `      <tr><td>${esc(t.id)}</td><td>${statusTag(t.status)}</td>` +
    `<td>${renderSteps(t.steps, TASK_STEPS)}</td></tr>`);
  return table(['Task', 'Status', 'Progress'], rows);
}

/** Render the stage tracker: one row per stage, with how much of it is settled. */
export function renderStageTable(tracker) {
  const rows = tracker.stages.map((s) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return `      <tr><td>${esc(s.stage)}</td><td>${esc(s.pr)}</td>` +
      `<td>${statusTag(s.status)}</td><td>${pct}%</td>` +
      `<td>${renderSteps(s.steps, STAGE_STEPS)}</td></tr>`;
  });
  return table(['Stage', 'PR', 'Status', '% tasks complete', 'Progress'], rows);
}

/**
 * Replace the first <table>…</table> inside the named section with the given
 * table HTML. Returns the new HTML (unchanged if no such section/table) — which
 * is how a spec written before the stage tracker existed passes through.
 */
export function applyTrackerToHtml(html, tableHtml, sectionId = 'task-tracker') {
  const sectionRe = new RegExp(`(<section\\b[^>]*\\bid="${sectionId}"[^>]*>)([\\s\\S]*?)(</section>)`);
  const m = html.match(sectionRe);
  if (!m) return html;
  const body = m[2].replace(/<table>[\s\S]*?<\/table>/, tableHtml);
  return html.slice(0, m.index) + m[1] + body + m[3] + html.slice(m.index + m[0].length);
}

/** Compute + render both live trackers and splice them into the HTML (read-only). */
export function renderLiveTracker(html) {
  const tracker = computeTracker(html);
  const out = applyTrackerToHtml(html, renderTrackerTable(tracker));
  return applyTrackerToHtml(out, renderStageTable(tracker), 'stage-tracker');
}

/**
 * Refresh the on-disk tracker snapshot so an offline view matches the plan.
 * Idempotent: only writes when the content actually changes.
 * @returns {{changed:boolean}}
 */
export function writeTrackerSnapshot(file) {
  const html = readFileSync(file, 'utf8');
  const next = renderLiveTracker(html);
  if (next === html) return { changed: false };
  writeFileSync(file, next);
  return { changed: true };
}

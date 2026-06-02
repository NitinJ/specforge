// Live task tracker: derive stage/task status from the structured plan and
// render it as a table. Used both for serve-time injection (read-only) and for
// the on-disk snapshot writer (keeps the offline view faithful).

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

/**
 * Compute the tracker model from spec HTML.
 * @returns {{stages:{stage:string, pr:string, status:string, taskIds:string[], done:number, total:number}[]}}
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
    };
  });
  return { stages };
}

const TAG_CLASS = {
  todo: 'todo', in_progress: 'warn', done: 'done', blocked: 'bad',
  deferred: 'todo', dropped: 'todo',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Render the tracker model as an HTML table. */
export function renderTrackerTable(tracker) {
  const rows = tracker.stages.map((s) => {
    const cls = TAG_CLASS[s.status] || 'todo';
    const tasks = s.taskIds.length ? esc(s.taskIds.join(', ')) : '—';
    const count = s.total ? ` (${s.done}/${s.total})` : '';
    return `      <tr><td>${esc(s.stage)}</td><td>${esc(s.pr)}</td><td>${tasks}</td>` +
      `<td><span class="tag ${cls}">${esc(s.status)}</span>${count}</td></tr>`;
  });
  return [
    '<table>',
    '      <thead><tr><th>Stage</th><th>PR</th><th>Tasks</th><th>Status</th></tr></thead>',
    '      <tbody>',
    ...rows,
    '      </tbody>',
    '    </table>',
  ].join('\n');
}

/**
 * Replace the first <table>…</table> inside <section id="task-tracker"> with the
 * given table HTML. Returns the new HTML (unchanged if no tracker section/table).
 */
export function applyTrackerToHtml(html, tableHtml) {
  const sectionRe = /(<section\b[^>]*\bid="task-tracker"[^>]*>)([\s\S]*?)(<\/section>)/;
  const m = html.match(sectionRe);
  if (!m) return html;
  const body = m[2].replace(/<table>[\s\S]*?<\/table>/, tableHtml);
  return html.slice(0, m.index) + m[1] + body + m[3] + html.slice(m.index + m[0].length);
}

/** Compute + render the live tracker and splice it into the HTML (read-only). */
export function renderLiveTracker(html) {
  return applyTrackerToHtml(html, renderTrackerTable(computeTracker(html)));
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

// Drift matrix (design §8.2). Given the active spec, the plan, and the evidence
// ledger, surface the reviewer-named cases where work happened but the spec
// wasn't kept in sync. Returns nudges (the Stop hook blocks with them).
//
// These are heuristics, not proofs — they nudge, they don't cage. Case 4
// (decisions written back) is a stage-boundary prompt since intent isn't
// observable from tool calls.

import { parsePlan, sectionBody } from './spec.mjs';

const SETTLED = new Set(['done', 'deferred', 'dropped']);
const dedupe = (a) => [...new Set(a)];

export function computeDrift(html, active, ledger) {
  const events = (ledger && ledger.events) || [];
  const plan = parsePlan(html);
  const nudges = [];

  // Case 2 — PR opened but the stage's data-sf-pr is stale.
  const prEvents = events.filter((e) => e.kind === 'pr');
  if (prEvents.length) {
    const stageKey = active && active.stage != null ? String(active.stage) : null;
    const stageObj = stageKey ? plan.find((s) => String(s.stage) === stageKey) : null;
    for (const pr of prEvents) {
      const num = pr.number || '';
      const cur = stageObj ? (stageObj.pr || '') : '';
      const recorded = num && cur && cur.includes(num.replace('#', ''));
      if (!recorded) {
        nudges.push(
          stageKey
            ? `You opened PR ${num || '(a PR)'} but stage ${stageKey} has no matching PR recorded — set its data-sf-pr (impl-cli pr).`
            : `You opened PR ${num || '(a PR)'} — record it on the active stage's data-sf-pr (impl-cli pr).`
        );
      }
    }
  }

  // Case 1 — commit/test happened but the active task is still "todo".
  const progressed = events.some((e) => e.kind === 'commit' || e.kind === 'test');
  if (progressed && active && active.task) {
    const task = plan.flatMap((s) => s.tasks).find((t) => t.id === String(active.task));
    if (task && task.status === 'todo') {
      nudges.push(`You committed/ran tests but task ${active.task} is still "todo" — update it (impl-cli task).`);
    }
  }

  // Cases 3 & 4 — a stage is complete but the impl-time sections are still stubs.
  const aStageDone = plan.some((s) => s.tasks.length && s.tasks.every((t) => SETTLED.has(t.status)));
  if (aStageDone && events.length) {
    const decisions = sectionBody(html, 'impl-decisions') || '';
    if (/none yet/i.test(decisions)) {
      nudges.push('A stage is complete but Design decisions / Deviations / Tradeoffs are still empty — record what you decided this stage.');
    }
  }

  return { nudges: dedupe(nudges) };
}

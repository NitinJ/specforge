// Google-Docs export relay for the v2 store. The browser can't call the Drive
// MCP, and only the session working the spec can, so "Export to Google Docs" is
// a relay: the route stamps a one-shot request on meta.export, the session's
// binding surfaces it and routes the agent to the export skill, and the skill
// reports the resulting Doc link back via the CLI. The state rides meta.export so
// it reaches the browser on the same /meta poll the action button already uses.
//
// The skill is named through harness.workRef, so the request reads as that CLI's
// own vocabulary rather than one CLI's plugin id.
//
// Lifecycle:  requested → working → done | error
// Modeled on the implement signal (store-drain.mjs): one-shot, surfaced once.

import { readMeta, mutateMeta } from './meta.mjs';
import { specsForSession } from './attach.mjs';
import { currentHarness } from './harness/index.mjs';

/** Queue an export for `id` (the browser route). @returns {object} meta.export */
export function requestExport(id, now = new Date().toISOString()) {
  if (!readMeta(id)) throw new Error(`unknown spec ${id}`);
  return mutateMeta(id, (meta) => ({
    ...meta, export: { state: 'requested', requestedAt: now },
  })).export;
}

/**
 * Specs a session owns with an export still awaiting the agent (state
 * 'requested'). Read-only — the hook advances them via markExportWorking so a
 * re-Stop never re-nudges (parallel to the review-batch pickup).
 */
export function exportRequestsForSession(sessionId) {
  return specsForSession(sessionId)
    .map((id) => readMeta(id))
    .filter((m) => m && m.export && m.export.state === 'requested');
}

/** Advance requested → working (the hook on surface, or the skill on start). */
export function markExportWorking(id) {
  let advanced = false;
  mutateMeta(id, (meta) => {
    // Re-checked inside the lock: the state is the guard against a second
    // surface re-nudging, and checking it outside would let two through.
    if (!meta.export || meta.export.state !== 'requested') return null;
    advanced = true;
    return { ...meta, export: { ...meta.export, state: 'working' } };
  });
  return advanced;
}

/** Record the export outcome: a Doc url (done) or an error message. */
export function finishExport(id, { url, error } = {}, now = new Date().toISOString()) {
  if (!readMeta(id)) throw new Error(`unknown spec ${id}`);
  if (!url && !error) throw new Error('finishExport: url or error required');
  const next = error
    ? { state: 'error', error: String(error), at: now }
    : { state: 'done', url: String(url), at: now };
  return mutateMeta(id, (meta) => ({ ...meta, export: next })).export;
}

/** Instruction text routing the agent to the export skill for the queued specs. */
export function exportReason(metas, harness = currentHarness()) {
  const lines = metas.map((m) => `  - spec ${m.id} ("${m.title}")`);
  return [
    `SpecForge: ${metas.length} spec(s) queued for export to Google Docs:`,
    ...lines,
    '',
    `Run ${harness.workRef('export')} now for each: read the spec HTML, create a`,
    'Google Doc via the Google Drive MCP, then report the link back with',
    'specforge export-done <id> --url <docUrl> (or --error "<msg>" on failure).',
  ].join('\n');
}

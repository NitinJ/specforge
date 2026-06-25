// Google-Docs export relay for the v2 store. The browser can't call the Drive
// MCP — only the attached Claude session can — so "Export to Google Docs" is a
// relay: the route stamps a one-shot request on meta.export, the session's hooks
// surface it and route Claude to the specforge:export skill, and the skill reports
// the resulting Doc link back via the CLI. The state rides meta.export so it
// reaches the browser on the same /meta poll the action button already uses.
//
// Lifecycle:  requested → working → done | error
// Modeled on the implement signal (store-drain.mjs) — one-shot, surfaced once.

import { readMeta, writeMeta } from './meta.mjs';
import { specsForSession } from './attach.mjs';

/** Queue an export for `id` (the browser route). @returns {object} meta.export */
export function requestExport(id, now = new Date().toISOString()) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  meta.export = { state: 'requested', requestedAt: now };
  return writeMeta(id, meta).export;
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
  const meta = readMeta(id);
  if (!meta || !meta.export || meta.export.state !== 'requested') return false;
  meta.export.state = 'working';
  writeMeta(id, meta);
  return true;
}

/** Record the export outcome: a Doc url (done) or an error message. */
export function finishExport(id, { url, error } = {}, now = new Date().toISOString()) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  if (!url && !error) throw new Error('finishExport: url or error required');
  meta.export = error
    ? { state: 'error', error: String(error), at: now }
    : { state: 'done', url: String(url), at: now };
  return writeMeta(id, meta).export;
}

/** Instruction text routing Claude to the export skill for the queued specs. */
export function exportReason(metas) {
  const lines = metas.map((m) => `  - spec ${m.id} ("${m.title}")`);
  return [
    `SpecForge: ${metas.length} spec(s) queued for export to Google Docs:`,
    ...lines,
    '',
    'Run the specforge:export skill now for each: read the spec HTML, create a',
    'Google Doc via the Google Drive MCP, then report the link back with',
    'specforge export-done <id> --url <docUrl> (or --error "<msg>" on failure).',
  ].join('\n');
}

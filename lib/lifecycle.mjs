// Spec lifecycle status. Two states and only two: every spec is a draft until a
// human approves it, and approved is the end of the line.
//
// One rule connects it to comments — an approved spec with an unresolved comment
// on it goes back to draft. Approval means "nothing left to argue about", so a
// new objection revokes it until someone resolves the thread.
//
// The status is written to BOTH meta.json (the source of truth the hooks read)
// and the spec HTML status badge (so the rendered spec updates live via SSE).
// One front door for the agent (specforge status) and the browser (POST .../status).

import { readMeta, writeMeta } from './meta.mjs';
import { readSpecHtml, writeSpecHtml } from './store.mjs';
import { setSpecStatus } from './plan-edit.mjs';

export const STATUSES = ['draft', 'approved'];

/**
 * Set a spec's lifecycle status. Writes meta.status + the HTML badge.
 * @returns {object} the updated meta
 */
export function setStatus(id, status) {
  if (!STATUSES.includes(status)) {
    throw new Error(`invalid status "${status}" — one of: ${STATUSES.join(', ')}`);
  }
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  meta.status = status;
  const written = writeMeta(id, meta);
  // Keep the rendered spec's badge in sync (best-effort — meta is authoritative).
  try {
    writeSpecHtml(id, setSpecStatus(readSpecHtml(id), status));
  } catch {
    /* spec.html may be unreadable; meta is the source of truth */
  }
  return written;
}

/**
 * Take approval back when a spec has an unresolved comment on it. Called from
 * mutateComments after every write to a spec's threads, which is the only way
 * that count can change; it takes the count rather than loading comments itself
 * so the comment store can depend on this module and not the other way round.
 * @param {number} unresolved threads on this spec whose state is not 'resolved'
 * @returns {boolean} true if the status changed
 */
export function revokeApprovalIfUnresolved(id, unresolved) {
  if (!unresolved) return false;
  const meta = readMeta(id);
  if (!meta || meta.status !== 'approved') return false;
  setStatus(id, 'draft');
  return true;
}

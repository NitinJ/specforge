// Spec lifecycle status transitions (the action-button state machine). The
// status is written to BOTH meta.json (the source of truth the hooks read) and
// the spec HTML status badge (so the rendered spec updates live via SSE). One
// front door for the agent (specforge status) and the browser (POST .../status).

import { readMeta, writeMeta } from './meta.mjs';
import { readSpecHtml, writeSpecHtml } from './store.mjs';
import { setSpecStatus } from './plan-edit.mjs';

export const STATUSES = ['draft', 'in_review', 'approved', 'implementing', 'done', 'closed'];

/**
 * Set a spec's lifecycle status. Writes meta.status + the HTML badge. Flipping to
 * `implementing` arms a one-shot signal the owning session's hooks surface as a
 * "start implementing" nudge (see store-drain).
 * @returns {object} the updated meta
 */
export function setStatus(id, status) {
  if (!STATUSES.includes(status)) {
    throw new Error(`invalid status "${status}" — one of: ${STATUSES.join(', ')}`);
  }
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  meta.status = status;
  if (status === 'implementing') meta.implementSignal = true;
  else delete meta.implementSignal;
  const written = writeMeta(id, meta);
  // Keep the rendered spec's badge in sync (best-effort — meta is authoritative).
  try {
    writeSpecHtml(id, setSpecStatus(readSpecHtml(id), status));
  } catch {
    /* spec.html may be unreadable; meta is the source of truth */
  }
  return written;
}

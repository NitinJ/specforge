// Display label for the session that owns a spec. No agent CLI persists a
// human-readable session name, and a derived "folder · first prompt" label read
// poorly, so we show the harness and a short session id.
//
// The harness is kept whole and the raw id is what gets shortened. Truncating
// the whole key to 8 characters gave `claude:s`, which names neither.

import { shortKey } from './attach.mjs';

/** `session <harness>:<8-char id>` when owned, or null when the spec is free. */
export function sessionDisplay(meta) {
  if (!meta || !meta.attachedSession) return null;
  return `session ${shortKey(meta.attachedSession)}`;
}

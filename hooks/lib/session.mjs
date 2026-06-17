// The session gate shared by every SpecForge hook (design §7).
//
// Each hook's first act: read $CLAUDE_CODE_SESSION_ID and look up the specs
// attached to it. When the session owns nothing (every non-spec session), the
// hook returns immediately — one small read keyed by an always-present env var,
// no project FS probe, no fabricated specsDir. This is what kills the v1
// idle-tax that blocked unrelated sessions.

import { specsForSession } from '../../lib/attach.mjs';

/**
 * @param {Record<string,string|undefined>} env
 * @returns {{ me: string, mine: string[] }} the session id + the spec ids it owns
 */
export function mineFor(env = process.env) {
  const me = env.CLAUDE_CODE_SESSION_ID || '';
  if (!me) return { me: '', mine: [] };
  return { me, mine: specsForSession(me) };
}

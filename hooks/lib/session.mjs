// The session gate shared by every SpecForge hook (design §7).
//
// Each hook's first act: read $CLAUDE_CODE_SESSION_ID and look up the specs
// attached to it. When the session owns nothing (every non-spec session), the
// hook returns immediately — one small read keyed by an always-present env var,
// no project FS probe, no fabricated specsDir. This is what kills the v1
// idle-tax that blocked unrelated sessions.

import { specsForSession } from '../../lib/attach.mjs';

/**
 * Claude Code sends `session_id` in every hook payload — that per-invocation id
 * is authoritative; $CLAUDE_CODE_SESSION_ID is the fallback for contexts where
 * only the env is available. Without the payload preference, a hook env missing
 * the var silently no-ops for a session that owns specs — heartbeats stop and
 * its locks go stale under a live session.
 * @param {Record<string,string|undefined>} env
 * @param {string} [inputSessionId] the hook payload's session_id
 * @returns {{ me: string, mine: string[] }} the session id + the spec ids it owns
 */
export function mineFor(env = process.env, inputSessionId = '') {
  const me = inputSessionId || env.SPECFORGE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || '';
  if (!me) return { me: '', mine: [] };
  return { me, mine: specsForSession(me) };
}

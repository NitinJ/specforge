// The session gate shared by every SpecForge hook (design §7).
//
// Each hook's first act: ask the running harness which session this is, and look
// up the specs attached to it. When the session owns nothing (every non-spec
// session), the hook returns immediately — one small read keyed by an
// always-present identifier, no project FS probe, no fabricated specsDir. This
// is what kills the v1 idle-tax that blocked unrelated sessions (E5).
//
// The identity used to be read here from $CLAUDE_CODE_SESSION_ID. It now comes
// from the harness record, so the same gate serves any agent CLI.

import { specsForSession } from '../../lib/attach.mjs';
import { currentHarness, currentSessionKey } from '../../lib/harness/index.mjs';

/**
 * The session key for this hook invocation, and the specs it owns.
 *
 * The event payload wins over the environment where a harness offers both: a
 * hook env missing its variable would otherwise silently no-op for a session
 * that owns specs, stopping its heartbeats and letting its locks go stale under
 * a live window. Which of the two a harness prefers is the harness's business,
 * not this module's.
 *
 * @param {Record<string,string|undefined>} env
 * @param {object|string} [payload] the hook payload, or just its session id
 * @returns {{ me: string, mine: string[], harness: object }}
 */
export function mineFor(env = process.env, payload = {}) {
  const harness = currentHarness(env);
  const ctx = {
    env,
    harness,
    payload: typeof payload === 'string' ? { session_id: payload } : (payload || {}),
  };
  const me = currentSessionKey(ctx);
  if (!me) return { me: '', mine: [], harness };
  return { me, mine: specsForSession(me), harness };
}

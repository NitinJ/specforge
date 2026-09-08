// The session gate shared by every SpecForge hook (design §7).
//
// Each hook's first act is to resolve its native payload session and look up the
// specs attached to it. When the session owns nothing, the hook returns
// immediately with no project filesystem probe.

import { specsForSession } from '../../lib/attach.mjs';
import { resolveSessionId } from '../../lib/harness-context.mjs';

/**
 * Claude and Codex send `session_id` in hook payloads. That per-invocation id is
 * authoritative; shared and native environment values are command fallbacks.
 * @param {Record<string,string|undefined>} env
 * @param {string} [inputSessionId] the hook payload's session_id
 * @returns {{ me: string, mine: string[] }} the session id + the spec ids it owns
 */
export function mineFor(env = process.env, inputSessionId) {
  // Native hooks can serialize an unavailable payload id as "". In that case
  // the process environment is still a valid fallback. Direct CLI callers keep
  // the ability to pass an explicit empty id to disable attachment.
  const me = resolveSessionId(env, inputSessionId || undefined);
  if (!me) return { me: '', mine: [] };
  return { me, mine: specsForSession(me) };
}

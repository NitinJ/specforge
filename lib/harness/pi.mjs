// The Pi harness (@earendil-works/pi-coding-agent).
//
// The five resolvers, and nothing else. Everything about Pi's event API lives in
// extensions/specforge.js; this file is what a subprocess reads when Pi's bash
// tool runs `specforge <verb>`, and it imports nothing from Pi.
//
// Spec e9ddcddef6, task 5.1.

import { sessionKey as compose } from '../session-key.mjs';

/**
 * Is this process running inside Pi?
 *
 * Pi sets two process markers, inherited by every child: `AI_AGENT=pi` is
 * generic, `PI_CODING_AGENT=true` is its own (docs/environment-variables.md
 * L11-19). Either is enough. `PI_SESSION_ID` is checked too, because it is what
 * the bash tool adds and it proves a session as well as a CLI.
 */
export function detect(env = process.env) {
  return Boolean(
    env.PI_CODING_AGENT
    || env.PI_SESSION_ID
    || String(env.AI_AGENT || '') === 'pi',
  );
}

export const pi = {
  id: 'pi',

  /** Replies are signed with this, so a thread says which CLI answered. */
  agentName: 'pi',

  /**
   * The session this process belongs to.
   *
   * Three sources, in the order they are trustworthy. The extension passes
   * `ctx.sessionManager`, whose `getSessionId()` returns the session UUID
   * (docs/session-format.md L436). A subprocess sees `PI_SESSION_ID`, which the
   * bash tool sets (docs/environment-variables.md L20-28). The payload is last,
   * for a caller that has already resolved it.
   *
   * The UUID rather than the session file path: `/resume` and `/tree` keep the
   * same session file, while `/fork` and `/clone` write a new one
   * (docs/sessions.md L118-127), so the id is the identity and the path is an
   * artefact of it. A fork is a new session, which matches Claude Code.
   */
  sessionKey({ payload = {}, env = process.env, sessionManager } = {}) {
    const mgr = sessionManager || payload.sessionManager;
    let raw = '';
    try {
      raw = (mgr && typeof mgr.getSessionId === 'function' && mgr.getSessionId()) || '';
    } catch {
      raw = ''; // an ephemeral session has no id, which is not an error
    }
    if (!raw) raw = env.PI_SESSION_ID || payload.sessionId || '';
    return compose('pi', raw);
  },

  /**
   * How a Notice names a unit of work.
   *
   * Pi expands a skill as a slash command, `/skill:<name>`, where the name is
   * the skill's own (docs/skills.md L74-92). There is no plugin prefix, which is
   * why the canonical work id is the directory name rather than a rendered
   * command.
   */
  workRef(workId) {
    return `/skill:${workId}`;
  },

  /**
   * Has this settle already followed a Notice?
   *
   * Pi has no equivalent of Claude Code's `stop_hook_active`, so the extension
   * tracks it and passes the answer in. Absent, this is false: saying something
   * twice is better than a session that settles owing a reply.
   */
  reentered({ payload = {}, reentered: flag } = {}) {
    return Boolean(flag ?? payload.reentered);
  },
};

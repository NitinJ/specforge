// The Claude Code harness.
//
// SpecForge grew up inside this one, so everything here was previously spread
// across hooks/lib/session.mjs, hooks/stop.mjs and lib/store-drain.mjs. Gathering
// it in one record is the whole point: a second CLI supplies the same five
// answers and needs no change anywhere else.
//
// Spec e9ddcddef6, task 1.1.

import { sessionKey as compose } from '../session-key.mjs';

/** The plugin name, which is what namespaces a skill's command. */
const PLUGIN = 'specforge';

/**
 * Is this process running inside Claude Code?
 *
 * Three markers, because they have different lifetimes: `CLAUDECODE` and
 * `AI_AGENT` are set on the process, while `CLAUDE_CODE_SESSION_ID` is what a
 * hook and a Bash subprocess both see. Any one of them is enough.
 */
export function detect(env = process.env) {
  return Boolean(
    env.CLAUDECODE
    || env.CLAUDE_CODE_SESSION_ID
    || String(env.AI_AGENT || '').startsWith('claude-code'),
  );
}

export const claude = {
  id: 'claude',

  /** Replies are signed with this. Unchanged from what the store already holds. */
  agentName: 'claude',

  /**
   * The session this process belongs to.
   *
   * The hook payload's `session_id` wins over the environment variable. Both are
   * usually present and identical, but a hook env missing the variable would
   * otherwise silently no-op for a session that owns specs, which stops its
   * heartbeats and lets its locks go stale under a live window.
   */
  sessionKey({ payload = {}, env = process.env } = {}) {
    const raw = payload.session_id || env.CLAUDE_CODE_SESSION_ID || '';
    return compose('claude', raw);
  },

  /**
   * How a Notice names a unit of work.
   *
   * A plugin skill is addressed `<plugin>:<skill>`, where the prefix comes from
   * the plugin directory and the last segment from the skill's own name. Verified
   * against Claude Code 2.1.245 (spec §8 Q1).
   */
  workRef(workId) {
    return `${PLUGIN}:${workId}`;
  },

  /**
   * Has this settle already followed a Notice?
   *
   * Claude Code answers it in the payload, which is what stops a blocking Stop
   * hook from looping forever.
   */
  reentered({ payload = {} } = {}) {
    return Boolean(payload.stop_hook_active);
  },
};

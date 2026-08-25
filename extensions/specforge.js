// SpecForge as a Pi extension.
//
// The mirror of hooks/*.mjs: translation, and nothing else. Every decision is
// lib/harness/policy.mjs, which names no CLI. What lives here is Pi's own
// vocabulary for the three moments SpecForge acts on.
//
//   session_start        a conversation began or resumed
//   before_agent_start   the agent is about to act on user input
//   agent_settled        the agent intends to stop
//
// `agent_settled` rather than `agent_end`: Pi documents `agent_end` as still
// possibly followed by an auto-retry, an auto-compaction, or a queued follow-up,
// while `agent_settled` fires only when Pi will not continue on its own
// (docs/extensions.md L567-582). That is the moment Claude Code's Stop describes.
//
// Fail-safe throughout. A SpecForge bug must never wedge somebody's session, so
// every handler catches and says nothing (E4, I5).
//
// Spec e9ddcddef6, tasks 5.2 to 5.4.

import { onEvent } from '../lib/harness/policy.mjs';
import { pi as harness } from '../lib/harness/pi.mjs';

/** How a message from SpecForge is labelled in the session transcript. */
const CUSTOM_TYPE = 'specforge';

/**
 * Register SpecForge's three handlers on a Pi instance.
 *
 * Exported and separate from the default export so a test can drive it with a
 * recording stand-in rather than a running Pi.
 *
 * @param {object} pi   the Pi extension API
 * @param {object} ctx  the ExtensionContext
 */
export function register(pi, ctx = {}) {
  // Pi has no equivalent of Claude Code's `stop_hook_active`. Without this a
  // Notice that refuses a settle would be re-sent on the settle it caused, and
  // again on the next, forever.
  let sentThisRound = false;

  /** The context policy reads, with Pi's session manager wired in. */
  const policyCtx = (over = {}) => ({
    harness,
    env: process.env,
    sessionManager: over.sessionManager || ctx.sessionManager,
    reentered: sentThisRound,
    ...over,
  });

  /** Never let a SpecForge failure reach the session. */
  const safely = (fn) => async (event, handlerCtx) => {
    try {
      return await fn(event, handlerCtx);
    } catch {
      return undefined;
    }
  };

  pi.on('session_start', safely(async (_event, c) => {
    // A new or resumed session has sent nothing yet, whatever the last one did.
    sentThisRound = false;
    const notice = onEvent('session_start', policyCtx({ sessionManager: c?.sessionManager }));
    if (!notice) return undefined;
    pi.sendMessage(message(notice), { deliverAs: 'nextTurn' });
    return undefined;
  }));

  pi.on('before_agent_start', safely(async (_event, c) => {
    // A turn the user just started is theirs to spend, so nothing is refused
    // here and the round's guard resets.
    sentThisRound = false;
    const notice = onEvent('turn_start', policyCtx({ sessionManager: c?.sessionManager }));
    if (!notice) return undefined;
    // Returned rather than sent: `before_agent_start` takes a message and puts
    // it in front of the model for this turn (docs/extensions.md L530-566).
    return { message: message(notice) };
  }));

  pi.on('agent_settled', safely(async (_event, c) => {
    const notice = onEvent('turn_settled', policyCtx({ sessionManager: c?.sessionManager }));
    if (!notice) return undefined;
    if (notice.mustAct) {
      sentThisRound = true;
      // followUp waits for the agent to finish its tool calls; triggerTurn makes
      // an idle agent run again. Together they are how Pi refuses a settle
      // (docs/extensions.md L1398-1420).
      pi.sendMessage(message(notice), { deliverAs: 'followUp', triggerTurn: true });
    } else {
      pi.sendMessage(message(notice), { deliverAs: 'nextTurn' });
    }
    return undefined;
  }));

  return pi;
}

/** A Notice as a Pi custom message. */
function message(notice) {
  return { customType: CUSTOM_TYPE, content: notice.text, display: true };
}

export default register;

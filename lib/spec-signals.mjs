// What a spec needs from you, at a glance.
//
// The index lists every spec in the store, which for a working store is close to
// a hundred rows. Title, type and status do not tell you which of them is
// waiting on you, so this computes the same review state the spec's own
// lifecycle button shows, plus whether it is published, and the index renders it
// per row.
//
// Deliberately the same rules as the review layer: if the index said "needs you"
// and the spec said "awaiting response", the index would be worse than nothing.

import { loadComments } from './store-comments.mjs';
import { isForAgent, wasSentToAgent } from './comments.mjs';
import { readMeta } from './meta.mjs';
import { isConnected, isStale } from './attach.mjs';
import { reviewProgressForSpec } from './store-inbox.mjs';

/**
 * Would comments submitted on this spec right now reach an agent by themselves?
 * That question, and not "is a session attached", is what connected means.
 *
 * A beating watcher says yes: it is the loop that notices a batch while the
 * session sits idle. So does a round a session has demonstrably taken — the
 * watcher stops the moment it hands a batch over, and reporting "disconnected"
 * while an agent is visibly answering the previous round would be the same lie
 * in reverse.
 *
 * Taken, not merely submitted. A pending batch is created by the reviewer
 * clicking Submit, so counting it would mean submitting comments to a spec
 * nobody is watching turned the badge green — the exact false positive this all
 * exists to remove. reviewProgress only leaves null once a session has surfaced
 * the batch to itself.
 *
 * Bounded by the lock as well, or a session that died mid-round would leave its
 * spec claiming to be connected forever. Once nothing has been heard from the
 * session for STALE_MS, an unfinished round is a leftover rather than work.
 */
export function specConnected(id, meta) {
  const m = meta || readMeta(id);
  if (!m || !m.attachedSession) return false;
  return isConnected(m) || (!!reviewProgressForSpec(id) && !isStale(m));
}

/**
 * The single state worth showing, in priority order. A spec can be several at
 * once (unsent comments AND replies to read); this reports the one that decides
 * what to do next, which is the one the lifecycle button would show.
 *
 *   needs      you have written comments for the agent that are not submitted
 *   replied    the agent answered every open thread; there are replies to read
 *   awaiting   sent, and at least one thread is still unanswered
 *   discussion open threads, none of them for the agent
 *   clear      nothing open
 */
export const REVIEW_STATES = ['needs', 'replied', 'awaiting', 'discussion', 'clear'];

/**
 * @param {string} id
 * @param {(id:string) => {url:string|null, live:boolean}|null} [shareInfo] from
 *   the daemon's publications registry. The record on disk holds only a token,
 *   so the URL has to be composed by whoever knows the current origin, and a
 *   record is not proof the link serves.
 * @param {object} [meta] the spec's meta, when the caller already has it —
 *   the index holds all of them, and re-reading one per row is a wasted parse.
 */
export function specSignals(id, shareInfo, meta) {
  let threads = [];
  try {
    threads = loadComments(id).threads || [];
  } catch {
    threads = []; // an unreadable store must not break the index
  }
  const open = threads.filter((t) => t.state !== 'resolved');

  // The three counts the lifecycle CTA reads, under the same names it uses:
  // pendingCount, unresolvedAgentCount, repliedAgentCount.
  const needs = open.filter((t) => isForAgent(t)).length;
  const inLoop = open.filter((t) => isForAgent(t) || wasSentToAgent(t));
  const replied = inLoop.filter((t) => t.state === 'replied').length;
  const discussion = open.filter((t) => !isForAgent(t) && !wasSentToAgent(t)).length;

  // "Replies to read" means EVERY open agent thread has been answered, which is
  // the CTA's own test. One answered thread out of three is still the agent's
  // turn, and calling that "replied" would put the spec under Needs you while
  // its own button said Awaiting response.
  const allAnswered = inLoop.length > 0 && replied >= inLoop.length;

  const share = shareInfo ? shareInfo(id) : null;

  return {
    open: open.length,
    needs,
    replied,
    sent: inLoop.length,
    awaiting: inLoop.length > 0 && !allAnswered,
    discussion,
    review: needs ? 'needs'
      : inLoop.length ? (allAnswered ? 'replied' : 'awaiting')
        : discussion ? 'discussion' : 'clear',
    connected: specConnected(id, meta),
    shared: !!share,
    shareUrl: share ? share.url : null,
    // A record is not proof the link works: cloudflared can die on its own, and
    // a record outlives a daemon that was killed outright.
    shareLive: !!(share && share.live && share.url),
  };
}

/** One short phrase per review state, for a tooltip. */
export const REVIEW_TITLE = {
  needs: 'comments written for the agent, not submitted yet',
  replied: 'the agent replied; there are replies to read',
  awaiting: 'submitted; the agent has not finished',
  discussion: 'open discussion between people',
  clear: 'nothing open',
};

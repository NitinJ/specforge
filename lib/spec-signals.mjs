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
import { listPendingForSpec } from './store-inbox.mjs';
import { readShare } from './store-share.mjs';

/**
 * The single state worth showing, in priority order. A spec can be several at
 * once (unsent comments AND replies to read); this reports the one that decides
 * what to do next, which is the one the lifecycle button would show.
 *
 *   needs      you have written comments for the agent that are not submitted
 *   replied    the agent answered; there are replies to read
 *   awaiting   a batch is with the agent
 *   discussion open threads, none of them for the agent
 *   clear      nothing open
 */
export const REVIEW_STATES = ['needs', 'replied', 'awaiting', 'discussion', 'clear'];

/**
 * @param {string} id
 * @param {(id:string) => boolean} [isShareLive] from the daemon's publications
 *   registry; a share record on disk can outlive the listener it names.
 */
export function specSignals(id, isShareLive) {
  let threads = [];
  try {
    threads = loadComments(id).threads || [];
  } catch {
    threads = []; // an unreadable store must not break the index
  }
  const open = threads.filter((t) => t.state !== 'resolved');

  const needs = open.filter((t) => isForAgent(t)).length;
  const replied = open.filter((t) => t.state === 'replied').length;
  const discussion = open.filter((t) => !isForAgent(t) && !wasSentToAgent(t)).length;

  let batches = 0;
  try {
    batches = listPendingForSpec(id).length;
  } catch {
    batches = 0;
  }

  const share = readShare(id);

  return {
    open: open.length,
    needs,
    replied,
    awaiting: batches > 0,
    discussion,
    review: needs ? 'needs'
      : replied ? 'replied'
        : batches ? 'awaiting'
          : discussion ? 'discussion' : 'clear',
    shared: !!share,
    shareUrl: share ? share.url : null,
    // A record is not proof the link works: cloudflared can die on its own, and
    // a record outlives a daemon that was killed outright.
    shareLive: share ? (isShareLive ? !!isShareLive(id) : false) : false,
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

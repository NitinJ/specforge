// Addressing: who a comment is for.
//
// A comment is agent work when it mentions @agent, and discussion otherwise.
// The rule reads the body and nothing else, which is what lets a thread that
// has been running between people be handed to an agent later by adding a
// comment, with no state to migrate.
//
// Mentions inside code are quotation rather than addressing. A spec routinely
// discusses its own syntax, and writing this rule down in a spec must not queue
// work against the spec describing it.

/** The one mention that routes a thread to an agent. */
export const AGENT_NAME = 'agent';

/**
 * Names a person may not take. `agent` would make addressing ambiguous;
 * `claude` is what the agent's own comments were authored as before authors
 * were free text, so it stays spoken for; `human` is what store-api records for
 * a write that carried no name at all, which in practice is the owner's own
 * browser — the one place review.js never asks for a name. A reviewer allowed
 * to take it would be indistinguishable from that default, and
 * collaborators.mjs reads the difference to decide who is external.
 *
 * Reserving it does not rewrite anything already on disk: a store written
 * before this could hold a reviewer named human, and their comments still read
 * as the owner's. It closes the hole going forward, which is all a rule on the
 * write path can do.
 */
export const RESERVED_NAMES = new Set([AGENT_NAME, 'claude', 'human']);

/** Longest display name kept. Past this a name stops being a name. */
export const MAX_AUTHOR_LEN = 40;

// A mention runs to the first non-word character, so "@agent." addresses the
// agent while "@agentina" is a different person.
const MENTION_RE = /@([a-z0-9_-]+)/gi;

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

/** Remove fenced blocks and inline code spans, leaving surrounding prose. */
export function stripCode(body) {
  return String(body == null ? '' : body)
    .replace(/```[\s\S]*?```/g, ' ')
    // Paired ticks only: an unmatched tick is a typo, and treating it as an
    // opener would silently swallow every mention after it.
    .replace(/`[^`\n]*`/g, ' ');
}

/** Every distinct name addressed in a body, in the order first seen. */
export function mentionNames(body) {
  const seen = [];
  for (const m of stripCode(body).matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase();
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/** True when this body addresses the agent. */
export function mentionsAgent(body) {
  return mentionNames(body).includes(AGENT_NAME);
}

/** True when `name` is spoken for and a person may not use it. */
export function isReservedName(name) {
  return RESERVED_NAMES.has(String(name == null ? '' : name).trim().toLowerCase());
}

/**
 * Coerce a client-supplied display name, or return null if it cannot be one.
 *
 * Names are self-asserted by design: the link is the capability and a name is a
 * label for a conversation, never an authorization check. What this rejects is
 * a name that would break the conversation: empty, a reserved name that would
 * make @agent ambiguous, or one long enough to wreck the comment rail.
 */
export function normalizeAuthor(name) {
  if (typeof name !== 'string') return null;
  // Control characters corrupt the rail's rendering and serve no purpose in a
  // display name.
  const clean = name.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (isReservedName(clean)) return null;
  return clean.slice(0, MAX_AUTHOR_LEN);
}

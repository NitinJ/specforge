// Which agent CLI is SpecForge running inside, and what does it answer?
//
// A harness is a record with five fields. Adding a third CLI means writing one
// adapter and adding it to ADAPTERS below; nothing under lib/ core, server/,
// components/ or templates/ changes (spec e9ddcddef6, E1).
//
// The record:
//   id          string, prefixes every session key
//   agentName   string, what a reply is signed with
//   sessionKey  (ctx) => string, the qualified key for this conversation
//   workRef     (workId) => string, how a Notice names a unit of work
//   reentered   (ctx) => boolean, whether this settle already followed a Notice
//
// `ctx` is `{ payload, env }`: the harness-native event payload, and the
// environment. A resolver reads whichever it needs.
//
// Nothing here throws. An unrecognised environment resolves to Claude Code,
// because that is what every existing install is and a hard failure at this
// point would wedge a session over a question that has a safe default.

import { claude, detect as detectClaude } from './claude.mjs';

/**
 * Every harness SpecForge knows, in detection order.
 *
 * Claude Code is last on purpose: it is also the fallback, and a marker-based
 * detector that ran first would claim a session belonging to a CLI that merely
 * inherited a stale CLAUDE_CODE_SESSION_ID from a parent shell.
 *
 * Adding a harness is one import and one entry here.
 */
const ADAPTERS = [
  { record: claude, detect: detectClaude },
];

/** Every harness record, for callers that need the set rather than the current one. */
export function harnesses() {
  return ADAPTERS.map((a) => a.record);
}

/** Every harness id. */
export function harnessIds() {
  return ADAPTERS.map((a) => a.record.id);
}

/** Every agent name, which is the set of names a person may not register under. */
export function agentNames() {
  return ADAPTERS.map((a) => a.record.agentName);
}

/** The harness with this id, or null. */
export function harnessById(id) {
  return ADAPTERS.find((a) => a.record.id === id)?.record ?? null;
}

/** The harness SpecForge falls back to when nothing else matches. */
export const DEFAULT_HARNESS = claude;

/**
 * Resolve the harness this process is running inside.
 *
 * SPECFORGE_HARNESS wins, so a person debugging one harness from inside another
 * can say so, and so a test never has to fake an environment. Then each
 * adapter's own marker. Then Claude Code.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {object} a harness record, never null
 */
export function currentHarness(env = process.env) {
  const named = env.SPECFORGE_HARNESS && harnessById(env.SPECFORGE_HARNESS);
  if (named) return named;
  for (const a of ADAPTERS) {
    try {
      if (a.detect(env)) return a.record;
    } catch {
      // A detector that throws is a broken adapter, not a reason to stop: the
      // next one may match, and the fallback is correct if none does.
    }
  }
  return DEFAULT_HARNESS;
}

/**
 * The session key for the current process, or '' when there is no session.
 *
 * The one call almost every caller wants. Returns '' rather than throwing when
 * a resolver fails, because every caller's next move is the same: own nothing,
 * do nothing (E4).
 */
export function currentSessionKey(ctx = {}) {
  try {
    const harness = ctx.harness || currentHarness(ctx.env);
    return harness.sessionKey(ctx) || '';
  } catch {
    return '';
  }
}

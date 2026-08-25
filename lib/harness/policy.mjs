// What SpecForge wants said to an agent, and whether it may be ignored.
//
// This module names no harness. It is the whole of the review loop's decision
// making, moved out of hooks/*.mjs so a second agent CLI reuses it rather than
// reimplementing it. A binding translates the answer into its own vocabulary
// and does nothing else (spec e9ddcddef6, I7).
//
// Three events, and only three:
//   session_start   a conversation began or resumed
//   turn_start      the agent is about to act on user input
//   turn_settled    the agent intends to stop
//
// A Notice is `{ text, mustAct }`. `mustAct` says the agent must not settle
// until it has acted; a binding expresses that however its own CLI can. One that
// cannot refuse a settle delivers it as an ordinary message and degrades to the
// state before this feature existed, which is a batch that waits rather than a
// batch that is lost (D4).
//
// This file deliberately names no CLI, and a test asserts it (I7). The names
// live one directory up, in the adapters.
//
// Nothing here throws. Every caller's move on a failure is the same: say
// nothing, let the turn proceed (E4).

import { specsForSession, markSeen } from '../attach.mjs';
import { pendingForSession, reviewReason, watcherBeating, armWatcherReason } from '../store-drain.mjs';
import { exportRequestsForSession, markExportWorking, exportReason } from '../store-export.mjs';
import { generateRequestsForSession, markGenerateWorking, generateReason } from '../store-generate.mjs';
import { sessionStartReason } from '../store-drain.mjs';
import { currentHarness } from './index.mjs';

/** The three moments SpecForge acts on. */
export const EVENTS = ['session_start', 'turn_start', 'turn_settled'];

/** A Notice the agent may ignore. */
const notice = (text) => (text ? { text, mustAct: false } : null);

/** A Notice the agent must act on before settling. */
const mustAct = (text) => (text ? { text, mustAct: true } : null);

/**
 * The queued work this session owns, in the order it is surfaced.
 *
 * Generate ahead of export because of who is waiting: an export lands in a
 * document the user opens later, while a template creation has a person sitting
 * in front of a dialog that named an ETA.
 *
 * Marking work as picked up is a side effect of surfacing it, which is why this
 * is one function rather than three checks a caller composes.
 */
function queued(me, harness) {
  const batches = pendingForSession(me);
  if (batches.length) return reviewReason(batches, harness);

  const toGenerate = generateRequestsForSession(me);
  if (toGenerate.length) {
    toGenerate.forEach((m) => markGenerateWorking(m.id));
    return generateReason(toGenerate, harness);
  }

  const toExport = exportRequestsForSession(me);
  if (toExport.length) {
    toExport.forEach((m) => markExportWorking(m.id));
    return exportReason(toExport, harness);
  }
  return '';
}

/**
 * Decide what to say for one event.
 *
 * @param {'session_start'|'turn_start'|'turn_settled'} event
 * @param {{harness?: object, env?: object, payload?: object, session?: string}} [ctx]
 * @returns {{text: string, mustAct: boolean}|null} null means say nothing
 */
export function onEvent(event, ctx = {}) {
  try {
    return decide(event, ctx);
  } catch {
    // A failure here must never wedge a session. The cost of saying nothing is
    // one missed reminder, which the next turn repeats.
    return null;
  }
}

function decide(event, ctx) {
  const harness = ctx.harness || currentHarness(ctx.env);
  const me = ctx.session !== undefined ? ctx.session : harness.sessionKey(ctx);
  if (!me) return null;

  const mine = specsForSession(me);
  if (!mine.length) return null; // ← the idle no-op, one keyed read (E5)

  if (event === 'session_start') return notice(sessionStartReason(mine, harness));

  // A turn proves the window still exists, which keeps its ownership lock. It
  // says nothing about whether anything is listening, so it does not beat.
  markSeen(me);

  const work = queued(me, harness);
  if (event === 'turn_start') return notice(work);

  if (event === 'turn_settled') {
    // Already acted on a Notice this settle: saying it again is a loop.
    if (harness.reentered(ctx)) return null;
    if (work) return mustAct(work);
    // Last: do not let a session settle owning specs nobody is listening to.
    // Settling in that state IS the bug, a spec that takes comments and delivers
    // none of them while the page says Disconnected.
    if (!watcherBeating(me)) return mustAct(armWatcherReason(mine, harness));
  }
  return null;
}

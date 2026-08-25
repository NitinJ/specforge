// Translate a Notice into Claude Code's hook JSON, and nothing else.
//
// Every SpecForge hook is now three lines: read the payload, ask the policy,
// write what it said. The policy lives in lib/harness/policy.mjs and names no
// harness; this file is the only place Claude Code's own vocabulary appears
// (spec e9ddcddef6, stage 3).
//
// Fail-safe throughout: any error drains to a clean exit, so a SpecForge bug can
// never wedge a session (E4, I5).

import { readStdin, parseInput } from './io.mjs';
import { onEvent } from '../../lib/harness/policy.mjs';

/**
 * Claude Code's shape for a Notice on this event.
 *
 * `mustAct` becomes `decision: 'block'`, which is how Claude Code refuses a
 * settle. Everything else is context appended to the turn.
 */
export function toHookOutput(event, hookEventName, notice) {
  if (!notice) return null;
  if (notice.mustAct) return { decision: 'block', reason: notice.text };
  return { hookSpecificOutput: { hookEventName, additionalContext: notice.text } };
}

/**
 * The whole body of a hook: payload in, decision out.
 *
 * Exported so a test can drive it with a payload rather than a pipe.
 */
export function run(event, hookEventName, input = {}, env = process.env) {
  return toHookOutput(event, hookEventName, onEvent(event, { payload: input, env }));
}

/** Read stdin, run the hook, write any decision, exit 0 whatever happens. */
export async function main(event, hookEventName) {
  try {
    const decision = run(event, hookEventName, parseInput(await readStdin()));
    if (decision) process.stdout.write(JSON.stringify(decision));
  } catch {
    // Deliberately silent. A hook that printed a stack trace would put it in
    // front of the user as if the model had said it.
  }
  process.exit(0);
}

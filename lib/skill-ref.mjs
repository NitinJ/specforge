// The skill id as the running harness resolves it — work addressing for the
// review loop's route texts, resolved once instead of per site.
//
// Claude Code namespaces plugin skills (`specforge:review-spec`) and its Skill
// tool accepts only the ids its own listing carries — a bare name is an
// "Unknown skill" error there. Pi has no namespace and its skill names allow
// only lowercase a-z, 0-9 and hyphens, so the colon form cannot exist under it.
//
// The marker is SPECFORGE_HARNESS, set by Pi's extension on the env it hands to
// the hooks it runs in-process and to the children it spawns. It is deliberately
// not SPECFORGE_SESSION_ID: that one is a harness-neutral session-id override
// (hooks/lib/session.mjs, and the wait-batch error text names it to the user),
// so a Claude Code user who sets it to arm a watcher from a plain terminal would
// otherwise be handed the bare name and get "Unknown skill" from their own Skill
// tool. Session identity and harness identity are separate questions.
//
// Codex exposes native thread variables to ordinary shell commands. A run with
// no recognized host signal keeps the Claude form, which is the strict default.

/** Harness constants are defined in the shared context module. */
export { PI_HARNESS, CODEX_HARNESS } from './harness-context.mjs';
import { PI_HARNESS, resolveHarness } from './harness-context.mjs';

/**
 * @param {string} name bare skill name, e.g. "review-spec"
 * @param {Record<string,string|undefined>} [env] defaults to the process env
 * @returns {string} the id the running harness resolves
 */
export function skillRef(name, env = process.env) {
  return resolveHarness(env) === PI_HARNESS ? name : `specforge:${name}`;
}

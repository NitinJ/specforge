// The skill id as the running harness resolves it — work addressing for the
// review loop's route texts, resolved once instead of per site.
//
// Claude Code namespaces plugin skills (`specforge:review-spec`) and its Skill
// tool accepts only the ids its own listing carries — a bare name is an
// "Unknown skill" error there. Pi has no namespace and its skill names allow
// only lowercase a-z, 0-9 and hyphens, so the colon form cannot exist under it.
//
// SPECFORGE_SESSION_ID is Pi's marker: its extension sets it for everything
// that generates text in-process or spawns (#256). Claude Code exports
// CLAUDE_CODE_SESSION_ID instead, and every other context — a bare `node` run,
// CI, the test suite — has neither, so it keeps the strict Claude id.

/**
 * @param {string} name bare skill name, e.g. "review-spec"
 * @param {Record<string,string|undefined>} [env] defaults to the process env
 * @returns {string} the id the running harness resolves
 */
export function skillRef(name, env = process.env) {
  return env.SPECFORGE_SESSION_ID ? name : `specforge:${name}`;
}
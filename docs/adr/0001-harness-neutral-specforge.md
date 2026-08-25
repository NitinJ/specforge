# ADR 0001: Harness-neutral SpecForge

- **Status:** Accepted (implemented in PRs #231 and #232, merged 2026-08-25)
- **Date:** 2026-08-25
- **Deciders:** nitin
- **Source spec:** SpecForge id `e9ddcddef6` — "Harness-neutral SpecForge: generalize, then add Pi" ([served](http://127.0.0.1:4180/spec/e9ddcddef6))

## Context

SpecForge ran only inside Claude Code. A scan over the repo (`scripts/scan-harness-coupling.mjs`, 2026-08-25) found 69 files carrying Claude-specific coupling: 73 uses of `${CLAUDE_PLUGIN_ROOT}` across 8 SKILL.md files, 68 skill ids carrying a colon, 10 reads of `CLAUDE_CODE_SESSION_ID`, 54 uses of Claude hook event names, and one hardcoded comment author. None of it sat in the daemon, the store, the component library or the renderers — the coupling was spread across skills, hooks and CLI glue rather than gathered at a boundary.

Pi was a committed second harness rather than an experiment, and Codex/Gemini were expected to follow. The work was therefore shaped so the third harness costs one adapter rather than a second port.

## Decision

Five concepts that were implicit Claude Code assumptions are each named and resolved in one place. A **harness** is a record supplying them; it is data, not a code path.

1. **Session identity** — session keys become `<harness>:<raw id>` (D3). A raw session id is unique only inside its own CLI, and two harnesses run on one machine against one store. An unprefixed key reads as `claude:`; no user runs a migration. Keys never reach filenames with a colon — the on-disk form encodes it as `__` (Windows reserves `:`), except legacy `claude:` keys which encode to their bare id.
2. **Agent identity** — replies are signed with the running harness's agent name (`claude`, `pi`), taken from the record instead of a literal (D2). The legacy fallback that infers agency from `author === 'claude'` is deliberately not widened (D7): an explicit `kind` field stays the only proof of authorship. Every harness's agent name joins the reserved mention names, derived from the registry.
3. **Harness events** — exactly three generalized events: `session_start`, `turn_start`, `turn_settled` (D5). A harness that fires more maps them down; one that fires fewer supplies what it can. Policy names no harness id — enforced by the coupling scan in CI (I7).
4. **Notice** — policy returns `{ text, mustAct }` or null instead of Claude Code's `decision: 'block'` (D4). A harness that cannot refuse a settle delivers a `mustAct` notice as an ordinary message and degrades to the pre-feature state; nothing is lost silently.
5. **Work addressing & self location** — work references render through `harness.workRef(workId)` (`specforge:review-spec` for Claude, `/skill:review-spec` for Pi); skills call a bare `specforge` binary from PATH instead of `${CLAUDE_PLUGIN_ROOT}` (D6).

Structural decisions:

- **One repository, two manifests** — `.claude-plugin/plugin.json` for Claude Code, a `pi` block in `package.json` for Pi. No core npm package split (D1).
- **Connections vs active harness** — attachment splits into `meta.connections` (a set keyed by harness id) and the active harness, which routes batches and gates writes to `spec.html` (D9). The human picks the active harness from a header switcher; every comment still addresses `@agent` (D10).
- **No agent-held lock** — nothing an agent does can change which harness is active, so a crashed agent cannot strand a spec (D11). Liveness (`lastBeat`, `watcherPid`) lives per connection, and liveness is decided by the pid, not the beat (D12).
- **Capability order** — capability 1 (generalize) shipped complete with Claude Code as the only harness before Pi was added, proving the seam against a green suite (D8).

## Consequences

**Positive**

- Adding harness number three costs one adapter file plus one registry entry, changing nothing under `lib/` core, `server/`, `components/` or `templates/`.
- Policy is testable without any CLI installed: the whole suite runs against fake harness records.
- Two harnesses can share one store without collision, and can connect to one spec with the human choosing who works it.
- Skill text is identical for every harness.

**Negative / accepted trade-offs**

- An indirection layer where there was none: three concepts to learn before editing a hook.
- Every key comparison must go through one helper (`lib/session-key.mjs`); treating a raw id as a key anywhere is now a bug.
- The settle-refusal guarantee is per harness, not global.
- Install must put `specforge` on PATH; a broken PATH is a new failure mode (reported by `specforge doctor`).

**Neutral**

- Legacy unprefixed session records stay untouched on disk; readers supply the missing prefix.
- The write gate is reported to agents via a `writable` field rather than enforced at the file level — routing (I9) keeps an inactive harness from receiving work in the first place.

## Verification

- Coupling scan reports zero hits outside `lib/harness/` and the two bindings (CI-enforced).
- Journeys J1–J4 walked on 2026-08-25 with both CLIs installed; J3 and J4 re-runnable via `scripts/walk-harness-journeys.mjs`. J2's live half (Pi answering an idle batch) awaits a Pi provider credential on the walk machine.
- `specforge doctor` reports resolved harness, session key, owned specs with active harness, watcher state, and PATH presence — the one-command check that the session-key migration landed.

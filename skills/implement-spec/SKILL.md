---
name: specforge:implement-spec
description: |
  Drive implementation of an approved spec stage by stage, keeping the spec the
  canonical source of truth. Use when the user asks to "implement", "build", or
  "start building" a spec. Sets the active-spec marker, works the plan with TDD,
  keeps the task tracker + impl-time sections (design decisions / deviations /
  tradeoffs) current, and honors one-PR-per-stage cadence. Blocked by the
  pre-implementation gate until the spec is ready.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# implement-spec

Implement an approved spec. The SpecForge hooks enforce that the spec stays in
sync with the work (tracker, PRs, decisions) and the stage→task→PR cadence.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory. `<specsDir>` defaults
to `<project>/specs`. Find the spec's id from the index
(`node "${CLAUDE_PLUGIN_ROOT}/server/start.mjs" --resolve "<spec-file>"` shows the
`/spec/<id>` URL) or by reading `.specforge/<id>/`.

## 1. Pre-implementation gate (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/impl-cli.mjs" gate "<specsDir>" "<specId>"
```

It checks: required sections, unique ids, the theme contract, a structured plan,
and **zero unresolved open questions** (`data-sf-q="open"`). If it **FAILs**,
**stop and tell the user exactly what's unresolved** — do not start implementing.
Resolving open questions / fixing the spec is the human's call.

## 2. Start

```
node "${CLAUDE_PLUGIN_ROOT}/lib/impl-cli.mjs" start "<specsDir>" "<specId>" --stage <N> --task <T>
```

Sets the active marker and the document status to `implementing`.

## 3. Work the plan, stage by stage (TDD, one PR per stage)

Work from the spec MAP, not the whole file — re-reading the full spec each stage
is wasteful (most of it is CSS/markup boilerplate):

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec "<spec-file>"
```

It lists every section + the stage/task plan with line ranges. For the stage
you're on, read only what you need — `spec-nav-cli.mjs section <id> --spec "<spec>"`
for the design section(s) that stage implements, and `xrefs <id>` / `grep "<term>"`
to see what else in the spec a change touches (so cross-cutting edits stay
consistent). Use `section impl-decisions` (etc.) to find the exact lines of the
impl-time stubs when you fill them in.

For each stage, top to bottom:

1. Mark the task in progress:
   `impl-cli task "<specsDir>" "<specId>" <taskId> in_progress`.
2. **Tests first**, then implementation (red → green → refactor).
3. When the task is complete: `impl-cli task … <taskId> done`.
4. Open **one PR per stage**. Record it:
   `impl-cli pr "<specsDir>" "<specId>" <stage> "#<N>"`.
5. At the **end of a stage**, write what you decided into the spec's
   `impl-decisions`, `deviations`, and `tradeoffs` sections (replace the
   "— none yet —" stubs). Keep the active marker's stage/task current with
   `impl-cli start … --stage <N> --task <T>` (it's idempotent).

Keep the spec the source of truth — update statuses/PRs **as you go**. The Stop
hook will nudge you if it sees a commit / PR / completed stage that the spec
doesn't reflect; address the nudge with the matching `impl-cli` call.

## 4. Finish

When all stages are done:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/impl-cli.mjs" finish "<specsDir>" "<specId>"
```

Sets status `done` and clears the active marker. The **human** marks the spec
`closed` (final) — that's not yours to do. A closed spec is edit-locked by the
PreToolUse guard.

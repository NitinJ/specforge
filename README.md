# SpecForge

A Claude Code plugin for **spec authoring, review & agent collaboration**.

SpecForge owns the full lifecycle of a design spec:

1. **Author** — skills generate house-style `.html` specs (light/dark, strong presentation, a structured Stages & Tasks plan, a live task tracker, and dedicated impl-time sections for design decisions / deviations / tradeoffs).
2. **Review & collaborate** — a bundled Node server renders any spec in the browser with a Google-Docs-style comment layer (sidebar + floating markers + highlights). A human leaves comments anchored to sections/quotes; submitting a batch is **auto-injected** into the active Claude session, which replies inline **and** amends the spec.
3. **Enforce** — hooks keep the spec and the implementation in lockstep: the task tracker, decisions, deviations & tradeoffs stay current, and the spec's stage→task→PR cadence is enforced.

**Zero runtime dependencies** — everything uses Node built-ins, so the plugin runs without `npm install`.

## Install

SpecForge ships its own local marketplace (`.claude-plugin/marketplace.json`).

```
claude plugin marketplace add /path/to/specforge
claude plugin install specforge@specforge
```

Then reload (`/reload-plugins`) or restart Claude Code. Requires Node ≥ 18.

## Lifecycle

```
request → author → review loop → approve → implement (enforced) → done → closed
 draft     draft     in_review     approved   implementing          done   closed
```

Spec status lives in `data-sf-spec-status` on the document root and the header badge.

## Skills

| Skill | Use it to | What it does |
|-------|-----------|--------------|
| `specforge:create-spec` | "write a spec for X" | Author a new house-style `.html` spec from the template; runs the lint (required sections, unique ids, light/dark theme contract, structured plan) before finishing. |
| `specforge:serve-spec` | "open/review this spec" | Boot (or focus) the local review server and open the spec with the review layer (live tracker + live reload) injected. `--watch` for hands-free review. |
| `specforge:review-spec` | (auto via Stop hook) or "process comments" | Reply inline to a submitted comment batch and amend the spec; mark the batch done. Replies are append-only; only humans resolve threads. |
| `specforge:implement-spec` | "implement this spec" | Drive implementation stage-by-stage (TDD, one PR per stage), gated by the pre-implementation gate; keeps tracker / PRs / decisions current. |

Thin slash commands wrap each: `/specforge:create`, `/specforge:serve`, `/specforge:review`, `/specforge:implement`.

## Review server

Zero-dep Node HTTP server (`server/start.mjs`), bound to `127.0.0.1`:

- `GET /` — spec index · `GET /spec/:id` — spec with the review layer injected.
- `GET /events` — per-spec SSE live-reload.
- `GET/POST /api/spec/:id/comments…` — comments API (create / reply / resolve / **submit**). The public API is **human-only**; agent replies are written to the store by `review-spec`.

It advertises its bound address at `<specsDir>/.specforge/server.json`. Comments are stored per spec at `<specsDir>/.specforge/<specId>/comments.json` and never mixed.

### Hands-free watch mode

`serve-spec --watch` (or `node server/start.mjs --watch`) polls the inbox and drains submitted batches by spawning a headless `claude -p` so review happens unattended.

- `SPECFORGE_CLAUDE_BIN` — the Claude binary (default `claude`).
- `SPECFORGE_WATCH_CLAUDE_ARGS` — extra flags (e.g. a permission mode for unattended edits).
- `--watch-interval <seconds>` — poll cadence (default 90, floored at 1).

## Hooks

All hooks are **fail-safe** (any error exits 0) and **no-op** unless there's relevant SpecForge state, so installing the plugin never disrupts an unrelated session.

| Event | Role |
|-------|------|
| `Stop` | Auto-inject pending comment review; enforce implementation drift (the 4 cases). Honors `stop_hook_active` as a loop guard. |
| `PostToolUse` | While a spec is active, record commits / PR ops / test runs / edits to the evidence ledger. |
| `PreToolUse` | Deny edits to a spec marked `closed`. |
| `SessionStart` / `UserPromptSubmit` | Drain fallback — surface pending review batches when no live session caught them. |

## Configuration

Defaults live in `lib/config.mjs`; override per project at `<project>/.specforge/config.json` (see `templates/config.example.json`):

| Key | Default | Meaning |
|-----|---------|---------|
| `specsDir` | `<project>/specs` | Where specs live (`~` expands). |
| `defaultTheme` | `dark` | Initial theme. |
| `port` | `4178` | Review server port (collision-fallback). |
| `naming` | `{date}-{slug}-spec.html` | New-spec filename. |
| `requiredSections` | (10 sections) | **Replaces** the enforced section list. |
| `additionalRequiredSections` | `[]` | **Appends** extra required sections. |
| `cadence` | `{onePRPerStage, tddRequired}` | Implementation cadence. |
| `trackComments` | `false` | Whether to git-track comment stores. |

## Development

```
node --test        # run the suite (zero deps)
```

See `templates/house-rules.md` for the authoring conventions and `CONTRIBUTING`/design notes below.

## Design notes & deviations

Built from the design spec (`~/workspace/specs/specforge/`). Notable, intentional deviations (flagged during the build):

- **Watch mode** uses a headless `claude -p` poller rather than the spec's imagined session self-wake (`ScheduleWakeup`) — a plugin cannot schedule the harness's wakeup. Strictly opt-in behind `--watch`.
- **PreToolUse gate backstop** is scoped to closed-spec protection; the pre-implementation gate's primary enforcement is at `implement-spec` entry (skill refusal) + the `impl-cli gate` command.
- Drift detection (`Stop` hook) is **heuristic** — it nudges, it doesn't cage. The "decisions written back" check is a stage-boundary prompt since intent isn't observable from tool calls.

## License

MIT © Nitin Jaglan

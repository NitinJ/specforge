# SpecForge

A **Claude Code plugin for spec authoring, browser review, and agent
collaboration.** SpecForge turns a vague request into a well-presented,
house-style spec, lets a human review it in the browser with Google-Docs-style
comments, and feeds those comments back to the Claude session that owns the spec —
which replies inline and amends the document.

**Zero runtime dependencies.** The bundled CLI and review server use only Node
built-ins — no `npm install`, no services to run.

## Highlights

- **Typed specs** — design · research · design+implementation · implementation-only; each scaffolds the right sections and depth.
- **Browser review** — Google-Docs-style **block** comments; submit a batch and the owning Claude session replies inline **and** amends the spec.
- **Token-efficient** — a per-spec section index (hand-rolled BM25, no embeddings) lets the agent open only the sections a comment touches instead of re-reading the whole document.
- **Live task tracker** — impl specs render their Stages → Tasks status live from the plan.
- **Contextual lifecycle CTA** — one button drives submit → LGTM → implement → done.
- **Polished review UI** — light/dark, responsive, floating TOC, auto-growing composer (`⌘↵` to send), and **Export → PDF**.
- **Zero runtime deps · fail-safe hooks** — pure Node built-ins; hooks no-op unless a spec is in play.

---

## What it does

1. **Author** — `/specforge:create` generates a light/dark, strongly-presented
   `.html` spec from a house template, picking the right **spec type** (design /
   research / design+implementation / implementation-only) and scaffolding that
   type's sections. Impl types also get a Stages → Tasks plan, a live task
   tracker, and impl-time sections (decisions / deviations / tradeoffs).
2. **Review** — a bundled, zero-dep daemon renders any spec in the browser with a
   comment layer: hover a block, click to comment, leave a batch. Submitting is
   delivered to the spec's owning Claude session at its next turn boundary; the
   agent replies inline **and** edits the spec. A floating **SpecForge** menu adds
   theme, width, contents, **Export → PDF**, and a contextual lifecycle button.
3. **Implement** — the spec and the work stay in lockstep: the task tracker
   renders live from the plan, and hooks nudge when the implementation drifts from
   the spec. Hooks are fail-safe and no-op unless a spec is in play.

---

## Requirements

- **[Claude Code](https://claude.com/claude-code)** — SpecForge is a plugin.
- **Node ≥ 18** on your `PATH` — runs the bundled CLI + review daemon (both
  zero-dependency).
- A modern browser for the review UI.
- *(dev only)* `jsdom` + `playwright` are dev-dependencies for the test tiers;
  not needed to use the plugin.

---

## Install

From GitHub:

```sh
claude plugin marketplace add NitinJ/specforge
claude plugin install specforge@specforge
```

Then `/reload-plugins` (or restart Claude Code).

From a local clone (development):

```sh
git clone https://github.com/NitinJ/specforge
claude plugin marketplace add ./specforge
claude plugin install specforge@specforge
```

**Updating** to a newer version (a reinstall is required to pick up skill/command
changes):

```sh
claude plugin marketplace update specforge
claude plugin uninstall specforge@specforge && claude plugin install specforge@specforge
```

Then `/reload-plugins`.

---

## Quickstart

```
/specforge:create research on on-device vs server inference for tryon
```

SpecForge infers the type (here, **research**), confirms it, scaffolds the spec
into the global store, starts the review daemon, and prints a URL. Open it:

- **Comment** — hover any block, click it, type, and **Submit**. The owning
  session picks the batch up automatically, replies inline, and amends the spec.
- **Act** — the floating **SF** button (bottom-right) opens the menu (Comments,
  Contents, Width, Theme, **Export PDF**, Session). The pill beside it is the
  contextual lifecycle action (see below).
- `/specforge:listall` lists every spec (with a picker to open/detach one);
  `/specforge:start` just prints the index URL.

---

## Spec types

`/specforge:create` picks a type from your wording and confirms it. Sections are
**recommended starting points** the authoring skill adapts to the problem — they
are *not* rigidly enforced.

| Type | Best for | Scaffolds |
|------|----------|-----------|
| `design` | a decision/architecture doc | problem · goals · design · alternatives · decisions · open questions |
| `research` | a findings report | question · background · method · findings · analysis · recommendations · sources |
| `design-impl` *(default)* | design **and** build it | the design sections **+** Stages/Tasks plan + live tracker + Runtime stubs |
| `impl` | build an existing design | light scope/prereqs **+** Stages/Tasks plan + live tracker + Runtime stubs |

Pass it explicitly if you like: `/specforge:create --type impl …`. The type is
stored in the spec's metadata and shown in `listall` + the browser index.

---

## Commands

| Command | What it does |
|---------|--------------|
| `/specforge:create` | Author a new spec (infers + confirms the type), open it for review. |
| `/specforge:convert <file>` | Bring an existing `.md`/`.html` design doc into the store (ingest as-is, or re-author into house style). |
| `/specforge:list` | List the specs attached to **this** session; open a free one or detach. |
| `/specforge:listall` | List **every** spec (id · title · type · status · attached) + the index URL; pick one to open/detach. |
| `/specforge:start` | Start (or reuse) the review daemon and print the index URL. |

Reviewing is automatic — the session a spec is attached to picks up submitted
comment batches via hooks; there's no separate serve/review/implement command.

---

## The lifecycle action button

The pill next to the SF button is one contextual call-to-action driven by the
spec's comments + status:

```
Submit comments → Awaiting response → Review replies → LGTM ✓ → Implement → → Implementing… → Done ✓
   open comment     submitted, agent    agent replied;   all          approved      (work in the
   (sends a batch)  is working          read & resolve   resolved                   attached session)
```

Status lives in `data-sf-spec-status` on the document root and the header badge:
`draft → in_review → approved → implementing → done → closed`.

---

## Review UI

The review layer is injected into every served spec (no build step) and themed
from the spec's own CSS variables:

- **Block comments** — hover any block, click to comment; threads anchor to the
  block by index + text and survive edits (falling back to the enclosing section).
- **Comments sidebar** — `Open / Resolved / All` segmented filter, **Resolve all**,
  and a footer carrying the lifecycle action + a "to submit" count.
- **Composer** — a clean, auto-growing input (no drag-grip, system font),
  `⌘↵` / `Ctrl+↵` to send, with the commented block quoted for context.
- **SpecForge launcher menu** — Comments, Contents (auto-built TOC when the spec
  has none), Width, Theme (light/dark, persisted), Session (+ Detach), and
  **Export PDF** (print → Save as PDF; the review chrome is stripped from the page).
- **Live reload** — editing the spec, or an agent reply, refreshes the open page
  over SSE.

---

## Architecture

- **Global store** — every spec lives at `~/.specforge/specs/<id>/`
  (`spec.html` + `meta.json` + `comments.json` + review inbox + nav index). Specs
  are not kept in your project repo.
- **Singleton daemon** (`server/daemon.mjs`) — one zero-dep Node HTTP server per
  machine, bound to `127.0.0.1`, advertised at `~/.specforge/server.json`
  (lockfile + pid/health check, port fall-forward). Serves the index, each spec
  with the review layer injected, an SSE live-reload stream, and a **human-only**
  comments API. Every command auto-starts or reuses it.
- **Session attachment** — a spec is attached to one Claude session (via
  `$CLAUDE_CODE_SESSION_ID`); that session receives its review batches. 1 session
  ↔ many specs; a spec is held by at most one live session (stale locks are
  reclaimed on a heartbeat timeout).
- **Review layer** — `server/public/review.{js,css}`, injected at serve time:
  block comments, the SF menu, the lifecycle button, theme/width, Export PDF.
- **Token-efficient navigation** — `spec-nav` (`lib/spec-nav-cli.mjs`) builds a
  per-spec section index (cached `idx.json`, regenerated on change) ranked with a
  hand-rolled Okapi BM25 (`lib/bm25.mjs`, no embeddings). The author/review skills
  fetch a compact `map` (sections · line ranges · token sizes) and open only the
  sections a comment touches (`grep` / `section` / `xrefs`) instead of re-reading
  the whole spec — a large token saving on real specs.
- **Hooks** — fail-safe (any error exits 0) and no-op unless a spec is relevant,
  so installing the plugin never disrupts an unrelated session.

| Hook | Role |
|------|------|
| `Stop` | Surface a pending comment batch for the owning session; nudge on implementation drift. |
| `UserPromptSubmit` / `SessionStart` | Fallback: surface pending batches a live session didn't catch. |
| `PostToolUse` | Record commits / PR ops / test runs / edits to the spec's evidence ledger. |
| `PreToolUse` | Deny edits to a spec marked `closed`. |

### Hands-free drain (opt-in)

A batch for a spec with a live owner is delivered in-context. **Orphaned** specs
(no live owner / stale lock) can be drained headlessly: start the daemon with
`SPECFORGE_DAEMON_DRAIN=1` and it spawns a headless `claude -p` for them.
`SPECFORGE_CLAUDE_BIN` overrides the binary; `SPECFORGE_WATCH_CLAUDE_ARGS` passes
extra flags (e.g. a permission mode).

---

## Configuration

Defaults live in `lib/config.mjs`; override per project at
`<project>/.specforge/config.json`:

| Key | Default | Meaning |
|-----|---------|---------|
| `specsDir` | `<project>/specs` | Legacy/local spec dir (`~` expands). |
| `defaultTheme` | `dark` | Initial theme. |
| `port` | `4178` | Preferred daemon port (collision fall-forward). |
| `requiredSections` | (the design-impl set) | **Advisory** — recommended sections for the skill. The lint no longer enforces sections. |
| `cadence` | `{onePRPerStage, tddRequired}` | Implementation cadence. |

The spec lint (`lib/lint-spec.mjs`) checks only universal basics — a title, a
lifecycle status, unique section ids, and the light/dark theme contract — so any
spec type passes regardless of which sections it carries.

---

## Tech

- **Node built-ins only** at runtime — HTTP daemon, file-backed store, hooks, and
  CLIs. No framework, no `npm install`.
- **Dependency-free review layer** — vanilla `review.js` / `review.css` injected at
  serve time; no bundler.
- **Hand-rolled BM25** for spec navigation — no embeddings or vector DB (the corpus
  is one spec's sections).
- **Self-contained specs** — each spec is a single `.html` with inline light/dark
  theme CSS: portable, diffable, printable.
- **Two CLIs** — `specforge` (store / daemon / review backend) and `spec-nav`
  (token-efficient section index).
- **Tests** — `node --test` unit + integration (jsdom for the review-layer DOM),
  with an optional Playwright tier for browser checks. Both are dev-only deps.

---

## Development

```sh
npm test          # the full suite (node --test; zero runtime deps)
```

- `lib/` — store, daemon client, CLI (`specforge`), lint, spec model, lifecycle.
- `server/` — the daemon + injected review layer (`public/review.{js,css}`).
- `skills/` — the authoring/review skills (invoked by the commands; hidden from
  the slash menu via `user-invocable: false`).
- `commands/` — the thin slash commands.
- `hooks/` — the fail-safe session hooks.
- `templates/` — the spec shells (`spec-base.html` impl, `spec-base-doc.html` doc)
  + house rules.

`jsdom` + `playwright` are dev-only (the review-layer test tiers). Contributions
go through a feature branch → PR → review → squash-merge.

## License

MIT © Nitin Jaglan

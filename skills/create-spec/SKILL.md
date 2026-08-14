---
name: specforge:create-spec
user-invocable: false
description: |
  Author a new house-style spec into the SpecForge store. Use when the user asks to
  "write a spec", "create a design doc", "draft a spec for <x>", "research <x>", or
  "plan to implement <x>". Picks the spec type (design | research | design-impl |
  impl | general), scaffolds the right shell, and authors the type's sections —
  light/dark HTML, stable section ids, a floating TOC; impl types also get a
  Stages/Tasks plan, a live task tracker, and impl-time stubs; general is the
  fallback when no type fits and the sections come from the use case. Lints the
  universal basics before done.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# create-spec

Generate a new SpecForge spec in the global store (`~/.specforge/specs/<id>/`),
honoring house rules, and lint it before declaring done. The daemon serves it and
injects the review layer at serve time.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory (the SpecForge repo root).

## 1. Understand the request + pick the type

- Identify the topic. If scope is unclear or has multiple interpretations, **ask
  before writing** — don't guess.
- **Infer the spec type** from the request, then confirm in one line ("Creating a
  *research* spec — sound right?"):
  - **research** — "research / investigate / explore / compare / evaluate / survey
    <X>". A findings report, not a build.
  - **design** — "design / architect / how should we <X>": a decision doc, no plan.
  - **design-impl** — "design and build / spec + plan for <X>": a design plus an
    implementation plan. Pick this whenever the request is a design that will be
    built, which is most of them.
  - **impl** — "plan to implement <existing design> / just the build plan": light
    design prose, heavy on stages/tasks.
  - **general** (the fallback, and the CLI default) — the request is a document
    that is none of the above: a proposal, a policy, a postmortem, a runbook, a
    comparison, a brief. It scaffolds the chrome and one TL;DR section; you decide
    every section from the use case. Reach for it only when no other type fits,
    never to avoid choosing.
- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.

## 2. Scaffold into the store

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>" --type <type>
```

Prints `{ id, htmlPath, url, status, type }`. It has started/reused the daemon,
copied the right shell to `htmlPath` (impl types → the full Stages/tracker/Runtime
shell; design/research → a chrome-only doc shell; general → the scaffold and a
TL;DR, nothing else), and attached the spec to this session. **Author into
`htmlPath`** — that file IS the spec.

The shell comes from the store's per-type **template spec** (`template-<type>`,
listed under Templates on the index) when one exists, else the bundled file. To
change what future specs start from, edit the template spec like any other spec
(open `template-<type>` and edit its html). Never delete a template spec.

## 3. Author from the shell — sections by type

Replace every `{{ … }}` placeholder (`{{TITLE}}`, `{{DATE}}` = today YYYY-MM-DD,
`{{STATUS}}` = `draft`, `{{OWNER}}`). The skeletons below are a **starting point —
adapt them to the actual problem** (add, drop, reorder, rename sections as the
topic calls for). Whatever sections you keep:

- **Keep every `<section>` with a stable, unique `id`** (anchors + comments depend
  on them). Keep the theme CSS (light/dark vars, `[data-theme]`,
  `prefers-color-scheme`, `--maxw`) — the review layer drives theme + width.
- **Color only via the canonical palette tokens** (`--bg --panel --panel2 --ink
  --muted --line --accent --green --amber --red --code --shadow --mono`) — the lint
  requires them and the review-layer theme variants re-tint by overriding exactly
  these. Don't invent per-spec color names (`--card`, `--ecru`, …); derive any tint
  with `color-mix(... var(--token) …)`. See `templates/house-rules.md` → Palette tokens.
- **Keep `<nav class="toc">` as the floating left sidebar** and keep its
  `<a href="#…">` entries in sync with the sections you end up with.

**general** — the shell ships `tldr` and nothing else, because the sections are
the use case's to decide. Work out what this document needs before you write it
(a proposal wants context / proposal / impact / decision; a postmortem wants
timeline / impact / root cause / actions; a runbook wants preconditions / steps /
rollback), then author those sections with stable kebab-case ids, add one TOC link
per section in document order, and stop. Do not import another type's skeleton
wholesale. If the document turns out to need stages and tasks, it is a
design-impl or impl spec: say so and rescaffold rather than growing a plan here.

**design** — `tldr` · `overview` (problem / motivation) · `goals` (goals &
non-goals) · `design` (the core: architecture, components, alternatives,
tradeoffs — use panels / tables / diagrams) · `decisions` · `open-questions`.
No build plan.

**research** — repurpose the doc shell's sections: `tldr` (headline finding) ·
`question` (objective) · `background` · `method` (scope + sources consulted) ·
`findings` (the bulk, organized by sub-question; cite evidence) · `analysis`
(synthesis) · `recommendations` · `open-questions` (gaps) · `sources`. Rename the
section headings + ids accordingly and update the TOC to match.

**design-impl** (impl shell) — author `tldr` · `overview` · `goals` · `design` ·
`decisions` · `open-questions`, then build `impl-plan` as Stages → Tasks using the
`data-sf-stage` / `data-sf-task` / `data-sf-status` markup (one stage = one PR,
each task a `verify:` note) and mirror it into the `task-tracker` snapshot table.
Leave `impl-decisions` / `deviations` / `tradeoffs` as the empty stubs (filled
during implementation).

**impl** (impl shell) — keep the design prose light: `tldr` · `overview` (scope +
link to the design if it lives elsewhere) · a brief `design` (prerequisites /
context). Focus on `impl-plan` (Stages → Tasks) + the `task-tracker` snapshot, and
keep the Runtime stubs. Trim `goals` / `decisions` if they add nothing.

## 3.5 Language (read before writing prose)

Specs follow a language contract — **read it**, it is short:
`${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`.

The rules that catch most drafts:

- **Every sentence carries a decision, measurement, source, assumption, or
  specification.** One that carries none gets cut.
- **No aphorisms.** If a line works as a standalone tweet, cut it. "A limit
  discovered through an upload failure is a support ticket" is not a spec; "Limits
  (25 MB, 8000 px, 3 files) render as chips on the dropzone" is.
- **No em dashes**, no attention-curating ("worth noting", "importantly"), no
  hedged decisions ("probably"), no precision theatre ("typically 1 to 3").
- **Write unknowns down.** An omitted threshold reads as "no threshold".
- Assume the reader has agreed to the direction: spend words on resolution, not
  persuasion.

## 4. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath>
```

Checks the universal basics: a title, a lifecycle status, unique section ids, and
the light/dark theme contract (per-type sections are recommended, not enforced).
Fix and re-run until `PASS`. **Don't finish on a failing lint.**

The `spec-language` line is advisory and never fails the lint, but it is the
contract talking: it counts em dashes, attention-curating phrases, precision
theatre and hedged decisions. Clear it before handing over. It cannot see
aphorism or an unlabelled sentence, so a clean report is a floor, not a pass.

## 5. Hand off + arm the review watcher

- Print the spec `url` (open it to review). Edits to `htmlPath` live-reload.
- The spec is attached to this session; review comments submitted in the browser
  come back here automatically.
- **Arm the review watcher (once per session)** so comments are picked up even
  while you're idle. If it isn't already running this session, start it in the
  **background**: `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" wait-batch`.
  Its completion wakes the session with `{ ready, pending }` — on `ready`, run the
  review-spec flow for each `pending` spec, then relaunch it. It does not expire
  on its own: it runs until a batch arrives or this session ends. One watcher
  covers every spec attached here.

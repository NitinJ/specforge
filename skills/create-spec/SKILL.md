---
name: specforge:create-spec
user-invocable: false
description: |
  Author a new house-style spec into the SpecForge store. Use when the user asks to
  "write a spec", "create a design doc", "draft a spec for <x>", "research <x>", or
  "plan to implement <x>". Picks the spec type (design | research | design-impl |
  impl), scaffolds the right shell, and authors the type's sections — light/dark
  HTML, stable section ids, a floating TOC; impl types also get a Stages/Tasks plan,
  a live task tracker, and impl-time stubs. Lints the universal basics before done.
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
  - **design-impl** (default) — "design and build / spec + plan for <X>": a design
    plus an implementation plan. Use this when unsure.
  - **impl** — "plan to implement <existing design> / just the build plan": light
    design prose, heavy on stages/tasks.
- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.

## 2. Scaffold into the store

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>" --type <type>
```

Prints `{ id, htmlPath, url, status, type }`. It has started/reused the daemon,
copied the right shell to `htmlPath` (impl types → the full Stages/tracker/Runtime
shell; design/research → a chrome-only doc shell), and attached the spec to this
session. **Author into `htmlPath`** — that file IS the spec.

## 3. Author from the shell — sections by type

Replace every `{{ … }}` placeholder (`{{TITLE}}`, `{{DATE}}` = today YYYY-MM-DD,
`{{STATUS}}` = `draft`, `{{OWNER}}`). The skeletons below are a **starting point —
adapt them to the actual problem** (add, drop, reorder, rename sections as the
topic calls for). Whatever sections you keep:

- **Keep every `<section>` with a stable, unique `id`** (anchors + comments depend
  on them). Keep the theme CSS (light/dark vars, `[data-theme]`,
  `prefers-color-scheme`, `--maxw`) — the review layer drives theme + width.
- **Keep `<nav class="toc">` as the floating left sidebar** and keep its
  `<a href="#…">` entries in sync with the sections you end up with.

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

## 4. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath>
```

Checks the universal basics — a title, a lifecycle status, unique section ids, and
the light/dark theme contract (per-type sections are recommended, not enforced).
Fix and re-run until `PASS`. **Don't finish on a failing lint.**

## 5. Hand off

- Print the spec `url` (open it to review). Edits to `htmlPath` live-reload.
- The spec is attached to this session; review comments submitted in the browser
  come back here automatically.

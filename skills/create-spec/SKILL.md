---
name: specforge:create-spec
user-invocable: false
description: |
  Author a new house-style design spec into the SpecForge store. Use when the
  user asks to "write a spec", "create a design doc", "draft a spec for
  <feature/bug>", or "start a spec". Produces a light/dark-capable HTML spec with
  the required sections, stable section IDs, a structured Stages & Tasks plan, a
  live task tracker, a floating TOC, and impl-time stubs (design decisions /
  deviations / tradeoffs). Enforces project house rules and lints before finishing.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# create-spec

Generate a new SpecForge spec in the global store, honoring house rules, and lint
it before declaring done. Specs live in the store (`~/.specforge/specs/<id>/`),
not in the project repo — the daemon serves them and the review layer is injected
at serve time.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory (the SpecForge repo
root). Read its files there.

## 1. Understand the request

- Identify the feature/bug/topic to spec. If scope is unclear or has multiple
  interpretations, **ask before writing** — don't guess.
- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.

## 2. Scaffold into the store

Run, with a concise human title for the spec:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>"
```

It prints JSON: `{ id, htmlPath, url, status }`. It has already (a) started or
reused the daemon, (b) copied the house template to `htmlPath`, and (c) attached
the spec to this session. **Author into `htmlPath`** — that file IS the spec.

## 3. Author from the template

Edit `htmlPath` in place. Replace every `{{ … }}` placeholder:
- `{{TITLE}}`, `{{DATE}}` (today, YYYY-MM-DD), `{{STATUS}}` (`draft`), `{{OWNER}}`.
- Fill `tldr`, `overview`, `goals`, `design`, `decisions`, and `open-questions`
  with real content.
- Build `impl-plan` as Stages → Tasks using the `data-sf-stage` / `data-sf-task` /
  `data-sf-status` markup. One stage = one PR. Each task gets a `verify:` note.
  Mirror the stages into the `task-tracker` snapshot table.
- Leave `impl-decisions`, `deviations`, `tradeoffs` as the empty stubs — they are
  filled during implementation.
- **Keep every `<section id="…">` and its id.** Anchors and the lint depend on
  them. Keep the theme CSS (light/dark vars, `[data-theme]`, `prefers-color-scheme`,
  `--maxw`) — there is no in-spec theme toggle or width slider; the review layer
  drives theme + width.
- **The TOC is a floating left sidebar — always.** Keep `<nav class="toc">` as the
  sticky left column; if you add/remove/rename a top-level `<section>`, update its
  matching `<a href="#…">` entry so the floating nav stays complete.

## 4. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath> --project "${CLAUDE_PLUGIN_ROOT}"
```

It checks required sections, unique section ids, the light/dark theme contract,
and a structured plan. Fix and re-run until it reports `PASS`. **Do not finish on
a failing lint.**

## 5. Hand off

- Print the spec `url` (open it in the browser to review). Edits to `htmlPath`
  live-reload the page.
- The spec is attached to this session; review comments submitted in the browser
  are delivered back here automatically.

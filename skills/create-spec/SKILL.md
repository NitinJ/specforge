---
name: specforge:create-spec
description: |
  Author a new house-style design spec as a self-contained .html file. Use when
  the user asks to "write a spec", "create a design doc", "draft a spec for
  <feature/bug>", or "start a spec". Produces a light/dark-capable HTML spec with
  the required sections, stable section IDs, a structured Stages & Tasks plan, a
  live task tracker, and impl-time stubs (design decisions / deviations /
  tradeoffs). Enforces project house rules and lints the result before finishing.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# create-spec

Generate a new SpecForge spec from the canonical template, honoring the project's
house rules, and lint it before declaring done.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory (the SpecForge repo
root). Read its files there.

## 1. Understand the request

- Identify the feature/bug/topic to spec from the user's request. If scope is
  unclear or has multiple interpretations, **ask before writing** — don't guess.
- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.

## 2. Resolve target path

- Determine the specs dir and naming. Default specs dir is `<project>/specs`;
  honor `<project>/.specforge/config.json` (`specsDir`, `naming`) if present.
- Filename: `{date}-{slug}-spec.html` — `date` = today (YYYY-MM-DD), `slug` =
  kebab-cased short title. Create the specs dir if needed.

## 3. Author from the template

- Copy `${CLAUDE_PLUGIN_ROOT}/templates/spec-base.html` to the target path.
- Replace every `{{ … }}` placeholder:
  - `{{TITLE}}`, `{{DATE}}`, `{{STATUS}}` (start at `draft`), `{{OWNER}}`.
  - Fill `tldr`, `overview`, `goals`, `design`, `decisions`, and
    `open-questions` with real content.
  - Build the `impl-plan` as Stages → Tasks using the `data-sf-stage` /
    `data-sf-task` / `data-sf-status` markup. One stage = one PR. Each task gets
    a `verify:` note. Mirror the stages into the `task-tracker` snapshot table.
  - Leave `impl-decisions`, `deviations`, `tradeoffs` as the empty stubs — they
    are filled during implementation.
- **Keep every `<section id="…">` and its id.** Anchors and the lint depend on
  them. Do not remove the theme CSS/toggle or the container-width slider.
- **The TOC is a floating left sidebar — always.** Every spec keeps
  `<nav class="toc">` as the sticky left-hand column that stays pinned in view
  while the main content scrolls — never an in-flow block that scrolls up and
  away. If you add, remove, or rename a top-level `<section>`, update its matching
  `<a href="#…">` entry in the TOC so the floating nav stays complete.

## 4. Lint (must pass)

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <path-to-new-spec> --project <project-root>
```

It checks required sections, unique section ids, the light/dark theme contract,
and a structured plan. If it reports `FAIL`, fix the spec and re-run until it
passes. **Do not finish on a failing lint.**

## 5. Hand off

- Report the spec path.
- Offer to open it for review with `specforge:serve-spec`.

---
name: specforge:convert-spec
description: |
  Convert an existing design/spec file into a SpecForge spec in the store. Use
  when the user asks to "convert <file> to a spec", "import this design doc", or
  "turn this markdown/HTML into a SpecForge spec". Handles two cases: an existing
  SpecForge-style .html is ingested as-is; a .md or freeform design doc is
  re-authored into a full house-style HTML spec. Attaches the result to this
  session and lints before finishing.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# convert-spec

Bring an existing file into the SpecForge store. `${CLAUDE_PLUGIN_ROOT}` is the
installed plugin directory.

## 1. Inspect the source

- The user names a file (`$ARGUMENTS`). Read it and decide:
  - **Already a SpecForge-style HTML spec** (has the section ids / theme contract /
    structured plan) → ingest as-is (step 2A).
  - **A `.md`, or a freeform `.html`/design doc** → re-author into a house-style
    spec (step 2B).

## 2A. Ingest an existing HTML spec

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" import "<file>" --title "<title>"
```

Prints `{ id, htmlPath, url, status }` — the file is copied into the store,
attached to this session, daemon ensured. Lint `htmlPath` (step 3). If lint fails
because it isn't house-style, fall back to 2B (author into the same `htmlPath`).

## 2B. Re-author a design doc into a house-style spec

- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.
- Scaffold a fresh store spec from the template:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>"
  ```

  It prints `{ id, htmlPath, url }`. **Author into `htmlPath`.**
- Map the source content onto the template sections (`tldr`, `overview`, `goals`,
  `design`, `decisions`, `open-questions`) and build `impl-plan` as Stages → Tasks
  (`data-sf-stage`/`data-sf-task`/`data-sf-status`, one stage = one PR, each task a
  `verify:` note), mirrored into the `task-tracker`. Preserve the author's intent;
  don't invent scope. Leave `impl-decisions`/`deviations`/`tradeoffs` as stubs.
- Keep every `<section id="…">`, the theme CSS, and the floating `<nav class="toc">`
  (update TOC links to match the sections you keep).

## 3. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath> --project "${CLAUDE_PLUGIN_ROOT}"
```

Fix and re-run until `PASS`. **Do not finish on a failing lint.**

## 4. Hand off

- Print the spec `url`. The spec is attached to this session; browser review
  comments are delivered back here automatically. Mention the original file is
  left untouched (its path is recorded as the spec's `origin`).

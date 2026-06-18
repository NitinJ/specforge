---
name: specforge:convert-spec
user-invocable: false
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
- **Infer the spec type** from the source — `research` (a findings report),
  `design` (a design doc, no plan), `design-impl` (design + a plan), or `impl` (a
  build plan). Default to `design-impl` when unsure. Pass it as `--type` below.

## 2A. Ingest an existing HTML spec

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" import "<file>" --title "<title>" --type <type>
```

Prints `{ id, htmlPath, url, status, type }` — the file is copied into the store,
attached to this session, daemon ensured. Lint `htmlPath` (step 3). If lint fails
because it isn't house-style, fall back to 2B (author into the same `htmlPath`).

## 2B. Re-author a design doc into a house-style spec

- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.
- Scaffold a fresh store spec from the template:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>" --type <type>
  ```

  It prints `{ id, htmlPath, url, type }`. **Author into `htmlPath`.**
- Map the source onto the type's sections exactly as the `create-spec` skill
  describes (design / research / design-impl / impl) — adapt sections to the
  content; keep stable unique ids, the theme, and the floating TOC in sync. For
  impl types build `impl-plan` as Stages → Tasks (`data-sf-stage`/`data-sf-task`/
  `data-sf-status`, one stage = one PR, each task a `verify:` note) mirrored into
  `task-tracker`, and leave the Runtime stubs. Preserve the author's intent; don't
  invent scope.
- Keep every `<section id="…">`, the theme CSS, and the floating `<nav class="toc">`
  (update TOC links to match the sections you keep).

## 3. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath>
```

Fix and re-run until `PASS`. **Do not finish on a failing lint.**

## 4. Hand off

- Print the spec `url`. The spec is attached to this session; browser review
  comments are delivered back here automatically. Mention the original file is
  left untouched (its path is recorded as the spec's `origin`).

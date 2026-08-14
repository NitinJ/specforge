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
  - **A `.md`** → convert with `import-md`, then edit the result (step 2B). Do not
    hand-author a markdown source: the CLI does the mechanical part faithfully and
    reports what it could not read, which is a better starting point than a blank
    scaffold and your reading of the file.
  - **A freeform `.html` design doc** → author it into a scaffolded spec by hand
    (step 2C). There is no deterministic path for arbitrary HTML.
- **Infer the spec type** from the source — `research` (a findings report),
  `design` (a design doc, no plan), `design-impl` (design + a plan), or `impl` (a
  build plan). When the source is none of those, use `general`: the scaffold plus
  a TL;DR, sections taken from the source's own headings. Pass it as `--type`
  below. A converted document keeps its own shape, so `general` is the right
  answer more often here than when authoring from scratch.

## 2A. Ingest an existing HTML spec

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" import "<file>" --title "<title>" --type <type>
```

Prints `{ id, htmlPath, url, status, type }` — the file is copied into the store,
attached to this session, daemon ensured. Lint `htmlPath` (step 3). If lint fails
because it isn't house-style, fall back to 2B (author into the same `htmlPath`).

## 2B. Convert a `.md` — deterministic pass first, then edit

**A markdown source is converted by the CLI, not by hand.** It reads the file,
maps its headings onto sections, rebuilds any plan into the `data-sf-*` markup,
inlines the images that sit beside it, and produces a lint-passing spec:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" import-md "<file>" [--title "<title>"] [--type <type>]
```

It prints `{ id, htmlPath, url, type, status, report }`. **Then edit `htmlPath`**
— the deterministic pass gives you a valid document to improve, never a blank
scaffold to fill.

Read the `report` before you touch anything; it is the list of what needs you:

- **`unsupported`** — constructs the parser could not read (setext headings,
  footnotes, reference links), each with its line number. The content is in the
  spec as plain text; convert it to house markup by hand.
- **`assetsDropped`** — images that were not inlined, with the reason (missing,
  too large, outside the source directory). Say so when you hand off.
- **`lint`** — `PASS` normally. If it is `FAIL`, `lintFailures` names the checks.
- **`sections`** — how many the source produced.

Type: omit `--type` and the import is a **`general`** spec, which imposes no
section set — usually right, because a converted document keeps its own shape.
Pass `--type` only when the source really is a design / research / impl doc.

Then improve the result:

- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`, and the
  language contract it points to: `${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`.
  This is where an original's essay voice leaks through: convert the content, not
  the register.
- Map the source onto the type's sections exactly as the `create-spec` skill
  describes (design / research / design-impl / impl) — adapt sections to the
  content; keep stable unique ids, the theme, and the floating TOC in sync. For
  impl types build `impl-plan` as Stages → Tasks (`data-sf-stage`/`data-sf-task`/
  `data-sf-status`, one stage = one PR, each task a `verify:` note) mirrored into
  `task-tracker`, and leave the Runtime stubs. Preserve the author's intent; don't
  invent scope.
- Keep every `<section id="…">`, the theme CSS, and the floating `<nav class="toc">`
  (update TOC links to match the sections you keep).

For a spec `general` no longer fits (the source turned out to be a design with a
build plan), rescaffold with `create --type <type>` and move the content across;
do not grow a plan inside a general spec and call it typed.

## 2C. Author a freeform HTML doc into a spec

Arbitrary HTML has no deterministic path: it carries someone else's structure and
styling, and there is nothing to map it onto mechanically. Scaffold and author:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>" --type <type>
```

It prints `{ id, htmlPath, url, type }`. **Author into `htmlPath`**, following the
same house rules, section mapping and language contract as 2B above.

## 3. Lint (must pass)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath>
```

Fix and re-run until `PASS`. **Do not finish on a failing lint.**

## 4. Hand off + arm the review watcher

- Print the spec `url`. The spec is attached to this session; browser review
  comments are delivered back here automatically. Mention the original file is
  left untouched (its path is recorded as the spec's `origin`).
- **Arm the review watcher (once per session)** so comments are picked up while
  you're idle. If it isn't already running this session, start it in the
  **background**: `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" wait-batch`.
  On its `{ ready, pending }` return, run review-spec for each `pending` spec then
  relaunch it. It does not expire on its own: it runs until a batch arrives or
  this session ends. One watcher covers every spec here.

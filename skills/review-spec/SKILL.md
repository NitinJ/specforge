---
name: specforge:review-spec
description: |
  Process a submitted batch of human comments on a spec: reply to each thread
  inline and amend the spec accordingly. Usually auto-invoked by the Stop hook
  when a comment batch is submitted in the browser; can also be run manually.
  Replies are append-only; only the human resolves threads.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# review-spec

Process one or more **pending review batches**: reply inline to each comment
thread and amend the spec per the comments. The browser updates live (the spec
file change triggers a reload; the sidebar also polls).

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory. `<specsDir>` defaults
to `<project>/specs` (honor `.specforge/config.json`).

## 1. Find pending batches

Pending batches are files at `<specsDir>/.specforge/<specId>/inbox/<batchId>.json`
(the Stop hook's message lists them). Read each batch file: it has `specId`,
`specPath`, `threadIds`, `batchId`.

## 2. Load comments + the spec MAP (don't read the whole spec)

For a batch's spec:
- The comment store is `<specsDir>/.specforge/<specId>/comments.json`. Read it to
  get each thread's `anchor.block` (`{ index, tag, text }` — `text` is the
  normalized text of the commented block) and the human comment text.
- Get the spec's structure cheaply instead of reading the whole file — this gives
  you the entire shape (sections, the plan, line ranges, token sizes) in a few
  hundred tokens; most of the raw HTML is CSS/markup boilerplate you don't need:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec "<specsDir>/<specPath>"
  ```

  Then pull only the sections you actually touch (step 3).

## 3. For each thread in the batch

Work each `threadId`:

1. **Locate** the commented block without reading the whole file. Grep a
   distinctive phrase from `anchor.block.text` to find its section, then open just
   that section (it reports the exact line range to target your Edit):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" grep "<phrase from anchor.block.text>" --spec "<spec>"
   node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" section <id> --spec "<spec>"
   ```
2. **Find coupled sections before editing** — this is how you safely change
   content far from the comment without going blind to the rest of the spec:
   - `spec-nav-cli.mjs xrefs <id> --spec "<spec>"` → sections that reference or
     mention this one (the plan, a table, the glossary…).
   - `spec-nav-cli.mjs grep "<old term/number you're changing>" --spec "<spec>"` →
     every place that term appears.
   Open each coupled section with `section <id>` and edit it too.
3. **Amend** with the Edit tool. **Preserve every `<section id="…">` and its id**
   (anchors and the lint depend on them); keep the theme CSS/toggle, TOC, and
   width slider. After changing a term/number, re-run `grep "<old term>"` and
   expect **zero hits** — that proves the edit is consistent across the spec.
   Re-run the lint if you changed structure:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" "<spec-file>" --project "<project>"`.
4. **Reply inline** (append-only, attributed to claude) via the CLI — never edit
   `comments.json` by hand, and never use the HTTP API (it is human-only):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/comment-cli.mjs" reply "<specsDir>" "<specId>" "<threadId>" --body-file "<reply.txt>" [--edited]
   ```

   Write your reply to a temp file and pass `--body-file`. Add `--edited` when
   this thread caused a spec change. Keep replies concise; reference the section
   you changed.

Do **not** resolve threads — only the human resolves (which closes them).

## 4. Mark the batch done

When every thread in a batch has a reply, clear it so the Stop hook stops
nudging:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/comment-cli.mjs" done "<specsDir>" "<specId>" "<batchId>"
```

## 5. Report

Briefly summarize: per spec, how many threads you replied to and which sections
you amended. The human will see your replies + edits live and resolve threads
they're satisfied with.

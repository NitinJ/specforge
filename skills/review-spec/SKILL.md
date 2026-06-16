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

## Live mode (attached) — the on-shift loop

When **attached** to a spec for live review, don't wait for the Stop hook — run
an on-shift loop that picks up each batch the instant the human submits it:

1. Long-poll for the next batch:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/comment-cli.mjs" await "<specsDir>" "<specId>" 25000
   ```

   - Prints a **batch JSON** object (`{ batchId, specId, specPath, threadIds, … }`)
     → that *is* the batch; process it with steps 2–4 below, then loop and `await`
     again.
   - Prints `empty` (the long-poll elapsed with no submit) → loop and `await` again.
   - Exits **non-zero** (no review server running) → stop the loop.

2. Stop after ~4 consecutive `empty` cycles (≈100s of silence) or when the human
   detaches, then end your turn. Anything submitted afterward is still caught by
   the Stop / UserPromptSubmit hook fallback.

In live mode the `await` output replaces step 1 below (finding pending batches);
loading, amending, replying, and marking done are identical.

## 1. Find pending batches

Pending batches are files at `<specsDir>/.specforge/<specId>/inbox/<batchId>.json`
(the Stop hook's message lists them). Read each batch file: it has `specId`,
`specPath`, `threadIds`, `batchId`.

## 2. Load the spec + its comments

For a batch's spec:
- The spec file is `<specsDir>/<specPath>`.
- The comment store is `<specsDir>/.specforge/<specId>/comments.json`. Read it to
  get each thread's `anchor.block` (`{ index, tag, text }` — `text` is the
  normalized text of the commented block) and the human comment text.

## 3. For each thread in the batch

Work each `threadId`:

1. **Understand** the human comment and where it points. The anchor is
   block-level: search the spec file for `anchor.block.text` to find the exact
   block the human commented on (`anchor.block.tag` + `index` disambiguate if the
   text repeats).
2. **Amend the spec** if the comment asks for a change — edit the relevant
   section with the Edit tool. **Preserve every `<section id="…">` and its id**
   (anchors and the lint depend on them); keep the theme CSS/toggle and TOC.
   Re-run the lint if you changed structure:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" "<spec-file>" --project "<project>"`.
3. **Reply inline** (append-only, attributed to claude) via the CLI — never edit
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

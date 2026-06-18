---
name: specforge:review-spec
user-invocable: false
description: |
  Process a submitted batch of human comments on a spec in the store: reply to
  each thread inline and amend the spec accordingly. Usually auto-invoked when the
  owning session's Stop/UserPromptSubmit hook surfaces a pending batch; can also
  be run manually. Replies are append-only; only the human resolves threads.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# review-spec

Process one or more **pending review batches** for specs in the global store:
reply inline to each comment thread and amend the spec per the comments. The
browser updates live (the spec file change triggers an SSE reload).

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory. Specs live in the
store at `~/.specforge/specs/<id>/spec.html`; you address them by spec **id**
(the hook message lists each batch's `specId` + `batchId`).

## 1. Load the threads + the spec path

For a batch's spec id:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" comments <id>
```

It prints `{ specId, htmlPath, threads, pending }`. `htmlPath` is the spec file to
edit; each thread has `anchor.block` (`{ index, tag, text }` — `text` is the
commented block's normalized text) and the human comment(s).

## 2. Get the spec MAP (don't read the whole file)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec "<htmlPath>"
```

This gives the whole shape (sections, plan, line ranges, token sizes) in a few
hundred tokens — most of the raw HTML is boilerplate. Pull only the sections you
touch.

## 3. For each thread in the batch

1. **Locate** the commented block: grep a distinctive phrase from
   `anchor.block.text`, then open just that section (it reports the exact line
   range):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" grep "<phrase>" --spec "<htmlPath>"
   node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" section <id> --spec "<htmlPath>"
   ```
2. **Find coupled sections before editing** — `xrefs <id>` and `grep "<old
   term>"` to find every place a changed term/number appears; open and edit those
   too.
3. **Amend** `htmlPath` with the Edit tool. **Preserve every `<section id="…">`
   and its id**; keep the theme CSS and the floating TOC (the review layer owns
   theme + width). After changing a term/number, re-run `grep "<old term>"` and
   expect **zero hits**. Re-run the lint if you changed structure:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" "<htmlPath>" --project "${CLAUDE_PLUGIN_ROOT}"`.
4. **Reply inline** (append-only, attributed to claude) via the CLI — never edit
   `comments.json` by hand, and never use the HTTP API (it is human-only):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" reply <id> <threadId> --body "<concise reply, name the section you changed>"
   ```

Do **not** resolve threads — only the human resolves (which closes them).

## 4. Mark the batch done

When every thread in a batch has a reply:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" batch-done <id> <batchId>
```

## 5. Report

Briefly summarize per spec: how many threads you replied to and which sections you
amended. The human sees your replies + edits live and resolves the threads they're
satisfied with.

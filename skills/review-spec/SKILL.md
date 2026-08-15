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

**A batch is not every thread on the spec.** Only threads where a human wrote
`@agent` are submitted; the rest are discussion between people and are not yours
to answer. Work the `threadIds` on the pending batch, and leave the others alone
even when you can see them and have an opinion.

Threads can carry **several people**. Each comment has an `author` (a display
name) and a `kind` of `human` or `agent`. Reply to the thread, not to one person,
and never assume the person who opened it is the one who added the mention.

It prints `{ specId, htmlPath, threads, pending }`. `htmlPath` is the spec file to
edit; each thread has `anchor.block` (`{ index, tag, text }` — `text` is the
commented block's normalized text) and the human comment(s).

## 1a. Read the batch's `origin` — it decides what you may do

Every pending batch carries `origin`, and it is the first thing to look at:

| `origin` | Who submitted | What you may do |
|---|---|---|
| `daemon` | The **owner**, from their own loopback page | Reply **and** amend the spec. The flow below, unchanged. |
| `share` | A **reviewer**, through a shared link or project | **Reply only.** Do not edit the spec. |

**On a `share` batch, `Edit` is not among your permitted actions.** Not on
`htmlPath`, not on any file in the store. You answer the question, and that is
the whole job. A reviewer holds a link, which says nothing about whose spec it
is; the owner decides what the document says.

That is not a limitation to apologise for in your reply, and not something to
mention at all unless asked. Answer the question on its merits. If the reviewer
proposed a change you think is right, say what you think and stop — do not
promise an edit, and do not say you are "unable" to make one.

**How a reviewer's suggestion becomes an edit:** the owner adds their own
`@agent` comment to the thread from their loopback page. That produces a
`daemon` batch carrying the *whole thread* — the reviewer's original, the
discussion, and the owner's instruction — and on that batch you amend the
document, reading everything as context and executing the owner's comment.
Nothing is lost by waiting, and nothing needs a queue: the thread is the queue.

A batch with no `origin` field predates it and is the owner's.

## 2. Get the spec MAP (don't read the whole file)

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec "<htmlPath>"
```

This gives the whole shape (sections, plan, line ranges, token sizes) in a few
hundred tokens — most of the raw HTML is boilerplate. Pull only the sections you
touch.

## 3. Mark the batch in-progress, then process each thread

Before amending, signal you're actively on it — the browser's action button flips
from "Picked up comments" to "Working on comments":

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" batch-working <id> <batchId>
```

Then, for each thread **listed in the batch** (not every thread on the spec).
**On a `share` batch, skip steps 1 to 3 entirely** — locating, cross-referencing
and amending are all edit work — and go straight to step 4, the reply:

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

   Prose you add is held to the same language contract as the original:
   `${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`. Answering a comment is
   where explanatory, persuading register creeps in — the spec is still a
   specification, not a reply. No aphorisms, no em dashes, no hedged decisions;
   every sentence carries a decision, measurement, source, assumption or
   specification. Watch the advisory `spec-language` line in the lint.
4. **Reply inline** (append-only, attributed to claude) via the CLI — never edit
   `comments.json` by hand, and never use the HTTP API (it is human-only):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" reply <id> <threadId> --body "<concise reply, name the section you changed>"
   ```

   **Answer first, then justify.** If the comment asked a question, the first
   sentence is the answer — not preamble, not a restatement of the question, not
   what you were about to do. Reasoning follows only if it is actually needed.

   **Two paragraphs maximum.** Most replies are one or two lines: what you
   changed and where (name the section). Verbosity in a comment is a defect, not
   thoroughness. No flair, no throat-clearing, no summarising what the human just
   said back at them.

   **If it genuinely needs a longer explanation, it does not belong in a
   comment.** Add a **Q&A** section to the spec (or append to the existing one)
   carrying the human's question and your answer, then reply with the short
   answer plus a pointer to that section. The spec is where long-form reasoning
   lives and stays discoverable; comments are for resolving a thread.

   Comment bodies render a **small markdown subset**. Use it to make the point
   land faster, never to decorate:
   - `**bold**` for the one term that matters, `*italic*`, `` `code`/`§ids` `` inline.
   - `- ` / `1. ` lists (each on its own line) when you made **several** distinct
     edits — one bullet per edit beats a comma-spliced sentence.
   - A blank line between paragraphs (the display renders them as separate blocks).

   Unsupported (headings, tables, links, blockquotes) render as literal text —
   don't use them. When in doubt, a single plain sentence is the right answer.

Do **not** resolve threads — only the human resolves (which closes them).

## 4. Mark the batch done

When every thread in a batch has a reply:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" batch-done <id> <batchId>
```

## 5. Report + re-arm the watcher

Briefly summarize per spec: how many threads you replied to and which sections you
amended (on a `share` batch, say that it was a reviewer's and that you answered
without amending, so the owner knows a promotion is theirs to make). The human
sees your replies + edits live and resolves the threads they're satisfied with.

Then **re-arm the review watcher** so the next batch wakes the session: relaunch
`node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" wait-batch` as a background task.

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

It prints `{ specId, htmlPath, language, threads, pending }`. `htmlPath` is the
spec file to edit; each thread has `anchor.block` (`{ index, tag, text }` —
`text` is the commented block's normalized text) and the human comment(s).

**`language` is the writing contract in force, and it is the whole of it.** Not a
note added to a contract you read somewhere else: it already contains SpecForge's
own rules, unless this store's owner edited or removed them. It applies to
everything you write here: replies, amendments, and asides alike, because a
register that changed between the spec body and the drafts written into it would
read as two authors. Follow what it says and nothing it does not.
Do not go looking for `references/spec-language.md` to supplement it: a rule the owner deleted is deleted.
They edit this in the Configuration pane, under Language.

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

   Prose you add is held to the same language contract as the original, which is
   the `language` from step 1 and not the file on disk. Answering a comment is
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

## Actions

A comment can name an **action**: a menu entry the reader picked instead of
typing the same request again. It looks like `@agent @visualize`, and the reader
may have typed a qualifier after it.

**`specforge comments <id>` resolves it for you.** A thread that names an action
carries an `actions` array, and everything you need is in it:

```json
"actions": [{
  "id": "visualize",
  "kind": "aside",
  "instruction": "Choose the form this content actually wants, a diagram, a table or a mock, …",
  "detail": "",
  "section": "object",
  "block": "b583",
  "run": "node \"…/specforge-cli.mjs\" aside c8fb987ad0 --section object --block b583 --action visualize --file <path>",
  "next": "This writes an aside, not an edit. Do not edit the section. …"
}]
```

- `batchId` says which submission asked for it. **Work only the actions whose
  `batchId` is the batch you are on.** Two batches can be pending at once and a
  thread can appear in both, so an action belonging to the next batch will be
  sitting right there on the thread you are reading.
- `instruction` is what you execute. **The name on the button is not the ask.**
  `@visualize` reads like ordinary English and it is not: it stands for a written
  standard, and following the word instead of the standard is how this went
  wrong four times in a row.
- `next` says what to do with the result. Read it before you touch the spec.
- `run`, where present, is the command, already carrying this thread's section
  and block. Run it rather than composing your own.
- `target`, on `@import` only, is the aside being folded in: the section and
  block it came from, and `guidance` from the action that wrote it. **What
  importing means depends on what kind of draft it is** — a diagram supersedes
  the prose it was drawn from, a plain-language rewrite sits beside it, a
  verification report is not spec prose at all and imports as corrections to the
  claims it found wrong. `next` already carries the guidance; the rule over all
  of them is **cut only what the draft carries forward**. A diagram covering
  three paragraphs of twelve replaces three, not twelve.

The whole list, outside a thread:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" actions            # all of them
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" actions <id>       # one
```

**Read it; do not remember it.** The instructions are edited, and a copy of one
in your head is the version that was true last month.

| id | Where the result goes |
|---|---|
| `@explain_simply` | aside |
| `@visualize` | aside |
| `@go_deeper` | aside |
| `@verify_against_code` | aside |
| `@help_me_decide` | aside |
| `@show_an_example` | aside |
| `@restructure` | in-place |
| `@tighten` | in-place |
| `@delete_block` | never reaches you; the browser removes the block itself |
| `@fix_the_naming` | in-place, whole spec |
| `@consistency_pass` | in-place, whole spec |
| `@canonicalize` | in-place, whole spec |
| `@import` | in-place, on an aside |
| `@delete` | never reaches you; the browser removes the aside itself |
| `@copy_link` | never reaches you; the browser answers it |

**The rule the table follows**: an action edits **in-place** when it changes the
form of content that is already there, and writes an **aside** when it produces
content that is not there yet. Each record carries its `kind`, so read that
rather than inferring from the label.

- **in-place** — edit the commented block or section directly, following the
  instruction. `@restructure` and `@canonicalize` rewrite everything in scope and
  nothing keeps the old version, so re-read what you are replacing before you
  replace it.
- **aside** — the output is a draft the reader decides on, not a claim the spec
  makes yet. **Do not edit the section the comment sits on.** Write your output
  to a file and run:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" aside <specId> \
    --section <sourceSectionId> --action <actionId> \
    --block <anchor.block.bid> --thread <threadId> --file <path-to-your-html>
  ```

  You do not have to assemble that: the thread's `run` field already carries it.

  It places the section, numbers the id and writes the attributes the review
  layer reads. **Do not hand-write that markup.** Getting any of them wrong
  produces a draft the reader cannot see or answer, and this has already happened
  once: a Visualize run wrote its diagram straight into the section, with no
  wrapper and no way to reject it.

  `--block` is the `bid` from the thread's `anchor.block`, and it is what puts
  the marker on the paragraph the reader asked about rather than at the top of
  the section. `--thread` is what `batch-done` checks: without it the draft
  answers no request, and a draft written last week on the same section would
  close today's batch. Pass both whenever the thread has them.

  What you write is the body only: the content, in the spec's own component
  vocabulary. The command adds the wrapper and the heading. An aside gets **no
  entry in the table of contents** and needs none added.

  Everything else about it is an ordinary section. It is commentable, it exports,
  and the verification gate reads its prose, so hold it to the same language
  contract as the rest of the spec.
- **whole spec** — scope is the document, not the block the comment sits on.
  These arrive from a right-click on the page background and anchor to the
  title, so the anchor is a place to hang the thread rather than the thing to
  change. Read the whole spec before you start: a consistency pass that has read
  one section has not done the work its name claims.
- **on an aside** — `@import` arrives from the button on an aside, so the comment
  is anchored inside one. Act on the aside the anchor sits in, and on nothing
  else. The other button, Delete, never reaches you: the browser removes the
  aside and its threads itself.

**Deleting a section deletes its asides with it.** They are drafts about that
section, and one left behind attaches itself to whatever section now precedes it.

**Two actions carry `needsDetail`**: `@verify_against_code` and
`@fix_the_naming`. Neither can run on its instruction alone — one needs the claim
to check and where to look, the other needs both terms of the rename. If the
comment carries nothing beyond the action, **say what you would have done and
ask**. A confident verification of the wrong claim, or a rename inferred from
the prose, is worse than a question.

Everything else in this skill still applies: an action arrives as a comment,
`origin` still decides whether you may edit, and the thread still gets a reply
saying what you did.

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

---
name: write-review
user-invocable: false
description: |
  Review a SpecForge spec as a reviewer agent, and file the review as a child
  spec of the spec being reviewed. Use when asked to "review spec <id>",
  "critique this spec", "give a second opinion on <spec>", or when a workflow
  hands you a spec to review. Creates the review with `specforge review`, writes
  a verdict and severity-ranked findings, credits you as a reviewer of the
  reviewed spec, and passes the verify gate. Not for answering comments on a
  spec you own: that is review-spec.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# write-review

A review is a spec of its own, filed under the spec it reviews. It gets its own
URL, status and comment threads, and the reviewed spec's **Child specs** drawer
lists every review it has had. The reviewed spec shows you as a reviewer on the
home page and in its header.

`${CLAUDE_PLUGIN_ROOT}` below denotes the installed plugin directory. Claude and
Pi export it; Codex provides the exact value in SpecForge SessionStart context.
Substitute that value in every path and shell command.

## The cadence

- **One review is one child spec.** Reviewing again after the author changed
  the spec is a new review, never an edit of the old one, so the history stays.
- **Never edit the reviewed spec**, and do not leave comments on it. The review
  is the channel. The author decides what changes.
- **Say so if you are its author.** The home page and header show who wrote it.
  A self-review is allowed when asked, and its scope section says it is one.

## 1. Read the spec you are reviewing

Resolve what you were given to a spec id first. A store id is 10 hex
characters; anything else, look up with:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" listall
```

Then read it by map and section rather than as one file:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec ~/.specforge/specs/<id>/spec.html
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" section <sectionId> --spec ~/.specforge/specs/<id>/spec.html
```

Check its claims against whatever it rests on: the code, the sibling specs it
links, the request it answers. A review that only read the spec says so.

## 2. Create the review

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" review <id> --model <your model id>
```

`--model` is your own model id, exactly as your harness names it (for example
`claude-opus-5`, `gpt-6-astra`, `glm-5.3-flash`). The harness is detected. The
command creates the child spec, credits you as its author, and credits you as a
reviewer of `<id>`.

It prints what `create` prints: `{ id, htmlPath, url, skeleton, prompts,
language, author, reviewOf, reviewers }`. Author into `htmlPath`, section by
section, as the `create-spec` skill describes. **`language` is the writing
contract in force; follow it.** **Read `prompts` before writing each section.**

## 3. Write the four sections

Verdict, what you reviewed, findings, questions for the author. The prompts
carry the rules. Keep the whole review short: five blocking and major findings
are worth more than twenty minor ones. Link each finding to the section it is
about, as `/spec/<reviewed id>#<section id>`.

## 4. Pass the gate

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" verify <reviewId> --json
```

The same loop as `create-spec` step 4: fix what fails, judge the ask rules,
three rounds at most.

## 5. Hand off

Print the review's URL and its verdict in one line. The review is attached to
your session, so comments on it reach you; arm delivery the way `create-spec`
step 5 describes.

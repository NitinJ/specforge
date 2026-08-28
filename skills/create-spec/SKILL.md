---
name: specforge:create-spec
user-invocable: false
description: |
  Author a new house-style spec into the SpecForge store. Use when the user asks to
  "write a spec", "create a design doc", "draft a spec for <x>", "research <x>",
  "write a PRD / UX spec / test plan / launch plan / security review", or "plan to
  implement <x>". Reads the installed spec types and picks the one whose "when to
  use" line fits, then scaffolds that type's shell and authors its sections against
  the guidance it carries — light/dark HTML, stable section ids, a floating TOC;
  impl types also get a Stages/Tasks plan, a live task tracker, and impl-time
  stubs; general is the fallback when nothing fits and the sections come from the
  use case. Lints the universal basics before done.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# create-spec

Generate a new SpecForge spec in the global store (`~/.specforge/specs/<id>/`),
honoring house rules, and lint it before declaring done. The daemon serves it and
injects the review layer at serve time.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory (the SpecForge repo root).

## 1. Understand the request + pick the type

- Identify the topic. If scope is unclear or has multiple interpretations, **ask
  before writing** — don't guess.
- **Read the type list before picking. It is the list, and it is not short:**

  ```
  node "${CLAUDE_PLUGIN_ROOT}/lib/spec-types-cli.mjs"
  ```

  Every type prints with a **when to use** line saying what it is for and what it
  is not for. That line is the rule. This skill deliberately does not repeat the
  types here: a copy in this file goes stale the moment a type is added or its
  description is sharpened, and a stale copy is worse than no copy because it
  reads as authoritative.

- **Pick by reading all of them, not by stopping at the first plausible match.**
  That is the failure this list exists to prevent, and it has a shape: a request
  to plan a release matches `general` on a quick read and `launch-plan` on a full
  one, and the first produces a document with none of the sections that make a
  launch survivable. Four rules settle nearly every case:

  - **The request names a type, take it.** "Write a PRD", "do a security review",
    "test plan for this" name a type. Do not reinterpret them.
  - **Two fit, take the more specific one.** A specific type carries sections and
    guidance the general one cannot. `design-impl` beats `general` for a design
    that will be built; `code-exploration-spec` beats `research` when the subject
    is code in this repo.
  - **The type is decided by what the document has to do, not by the verb.**
    "Explore" appears in `research`, `exploration-spec`, `code-exploration-spec`
    and `design-exploration-spec`, and the four differ by whether there is a
    question with a right answer, a space to map, a codebase to read, or options
    to compare.
  - **`general` is the fallback, never the way to avoid choosing.** Reach for it
    only when you have read the list and nothing fits, and say in one line what
    it did not fit, since that is how a missing type gets noticed.

- **Confirm in one line before writing** ("Creating a *launch-plan* spec — sound
  right?"). One line, not a menu: the user corrects a wrong pick faster than they
  answer a question about it.
- Read the house rules: `${CLAUDE_PLUGIN_ROOT}/templates/house-rules.md`.
- Read the component rules: `${CLAUDE_PLUGIN_ROOT}/references/spec-components.md`.
  43 components, each with the rule for when it applies. Pick by what a block
  **asserts**, never by how it should look. Its **Drawing** section is the choice
  between the three ways to draw; read it before writing any diagram, because the
  cheapest option and the most powerful one are different choices:
  - a graph (flowchart, sequence, state, ER, class) is
    `<pre data-lang="mermaid">`, and states the relationships rather than any
    coordinates;
  - a picture where exact placement carries meaning is inline SVG;
  - a comparison, peer items, or anything that must reflow is a table or a grid,
    not a diagram at all.

  Its **Interactive components** section covers the three blocks that respond to
  a reader (`<details class="disclosure">`, `.tabs`, `table.sortable`). Read it
  before reaching for one. All three are complete with no JavaScript, so write
  the content as though nothing will run; what they cost is a reader's attention,
  not their access. The disclosure is the safe one and the only one three
  document products ship natively. **Never put a section heading inside a
  disclosure** — a part of the argument behind a summary line is a part a reader
  misses, and the lint reports it.

## 2. Scaffold into the store

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" create --title "<title>" --type <type> [--project <name>]
```

Prints `{ id, htmlPath, url, status, type, project, language, prompts }`. It has
started/reused the daemon, copied the type's shell to `htmlPath`, and attached the
spec to this session. **Author into `htmlPath`** — that file IS the spec.

**Most types arrive with their sections already in place.** The shell you get is
that type's own: its headings, its table of contents, its `{{ … }}` placeholders.
When that is what you find, the section set is decided and your job is to fill it,
not to redesign it. Only `general` arrives with nothing but a TL;DR, because
choosing the sections is what that type is for.

**`language` is the user's authoring direction, and it outranks the house
register.** A non-empty string is how this user wants specs written: their tone,
their sentence length, their language. Apply it to everything you write into the
spec. Where it contradicts the language contract in
`references/spec-language.md`, the user's direction wins — the contract is the
default, this is the setting. Empty means no direction, which is every store
that has not customized one. Set in the Configuration pane, not here.

**Read `prompts` before you write.** Each entry is `{ section, text }`: authoring
guidance the spec type attaches to one section, written by the user into the
template and stripped out of your copy so a reader never sees it. It is
instruction, not content — follow it when you write that section. Open questions
and Decisions carry one on most types, because those are the two sections review
corrects most.

**Projects.** With no `--project`, the spec is filed into whichever project the
home page is showing, which is usually what the user means: they are working
inside that body of work. Pass it explicitly only when the request names a
different one, or when the spec plainly belongs elsewhere — and say where it went
in the one-line confirmation, since the default is invisible otherwise. Use
`--project ""` to file it nowhere. A project that does not exist yet is created
by using its name.

The shell comes from the store's per-type **template spec** (`template-<type>`,
listed under Templates on the index) when one exists, else the bundled file. To
change what future specs start from, edit the template spec like any other spec
(open `template-<type>` and edit its html). Never delete a template spec.

## 3. Author from the shell — sections by type

Replace every `{{ … }}` placeholder (`{{TITLE}}`, `{{DATE}}` = today YYYY-MM-DD,
`{{STATUS}}` = `draft`, `{{OWNER}}`).

**If the shell already carries this type's sections, they are the skeleton.** The
`prompts` from `create` say what belongs in each one, and the skeletons below are
for the types that do not ship with their own: read them as an example of the
shape, not as a list to impose on a scaffold that already has one. Adding, cutting
or reordering a shipped type's sections is a decision worth making, not a default:
they are what makes that type worth having, and the type's rules are written
against them.

Whatever sections you end up with:

- **Keep every `<section>` with a stable, unique `id`** (anchors + comments depend
  on them). Keep the theme CSS (light/dark vars, `[data-theme]`,
  `prefers-color-scheme`, `--maxw`) — the review layer drives theme + width.
- **Leave the stamped component block alone.** The shell's `<style>` opens with
  `/* specforge:components v1 start */ … /* specforge:components end */`. It is
  generated; editing it is refused by `components sync` and overwritten by the
  next build. Your own rules go after it and win. Use the library's classes
  rather than restyling them: a notice is `<div class="callout decision">`, never
  `<div class="callout warn">`.
- **Color only via the canonical palette tokens** (`--bg --panel --panel2 --ink
  --muted --line --accent --green --amber --red --code --shadow --mono`) — the lint
  requires them and the review-layer theme variants re-tint by overriding exactly
  these. Don't invent per-spec color names (`--card`, `--ecru`, …); derive any tint
  with `color-mix(... var(--token) …)`. See `templates/house-rules.md` → Palette tokens.
- **Keep `<nav class="toc">` as the floating left sidebar** and keep its
  `<a href="#…">` entries in sync with the sections you end up with.

**general** — the shell ships `tldr` and nothing else, because the sections are
the use case's to decide. Work out what this document needs before you write it
(a proposal wants context / proposal / impact / decision; a postmortem wants
timeline / impact / root cause / actions; a runbook wants preconditions / steps /
rollback), then author those sections with stable kebab-case ids, add one TOC link
per section in document order, and stop. Do not import another type's skeleton
wholesale. If the document turns out to need stages and tasks, it is a
design-impl or impl spec: say so and rescaffold rather than growing a plan here.

**design** — `tldr` · `overview` (problem / motivation) · `goals` (goals &
non-goals) · `design` (the core: architecture, components, alternatives,
tradeoffs — use panels / tables / diagrams) · `decisions` · `open-questions`.
No build plan.

**research** — repurpose the doc shell's sections: `tldr` (headline finding) ·
`question` (objective) · `background` · `method` (scope + sources consulted) ·
`findings` (the bulk, organized by sub-question; cite evidence) · `analysis`
(synthesis) · `recommendations` · `open-questions` (gaps) · `sources`. Rename the
section headings + ids accordingly and update the TOC to match.

**design-impl** (impl shell) — author `tldr` · `overview` · `goals` · `design` ·
`decisions` · `open-questions`, then build `impl-plan` as Stages → Tasks using the
`data-sf-stage` / `data-sf-task` / `data-sf-status` markup (one stage = one PR,
each task a `verify:` note) and mirror it into the `task-tracker` snapshot table.
Leave `impl-decisions` / `deviations` / `tradeoffs` as the empty stubs (filled
during implementation).

**impl** (impl shell) — keep the design prose light: `tldr` · `overview` (scope +
link to the design if it lives elsewhere) · a brief `design` (prerequisites /
context). Focus on `impl-plan` (Stages → Tasks) + the `task-tracker` snapshot, and
keep the Runtime stubs. Trim `goals` / `decisions` if they add nothing.

## 3.5 Language (read before writing prose)

Specs follow a language contract — **read it**, it is short:
`${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`.

The rules that catch most drafts:

- **Every sentence carries a decision, measurement, source, assumption, or
  specification.** One that carries none gets cut.
- **No aphorisms.** If a line works as a standalone tweet, cut it. "A limit
  discovered through an upload failure is a support ticket" is not a spec; "Limits
  (25 MB, 8000 px, 3 files) render as chips on the dropzone" is.
- **No em dashes**, no attention-curating ("worth noting", "importantly"), no
  hedged decisions ("probably"), no precision theatre ("typically 1 to 3").
- **Write unknowns down.** An omitted threshold reads as "no threshold".
- Assume the reader has agreed to the direction: spend words on resolution, not
  persuasion.

## 4. The gate — loop until it passes

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" verify <id> --json
```

**The spec is not finished until this exits 0.** It is a gate, not a report: run
it, fix what it names, run it again, repeat.

On FAIL it returns `failing`, and every entry says what is wrong and what to do:

- `kind: "check"` — a function found a defect. **Fix the spec.**
- `kind: "judge"` — no function can answer this one. **Read the spec against
  it.** If the spec satisfies it, name it in `--judged` on the next run. If it
  does not, fix the spec.

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" verify <id> --judged tldr-matches-body,decisions-have-reasons
```

`--judged` is your word, and it lasts one run — nothing is stored, so the next
run asks again. A rule it does not recognise fails the gate rather than being
ignored, so a typo cannot quietly settle nothing. A judged id never papers over a
`check` defect: claiming to have judged a broken spec still fails.

**Judge in a subagent if your harness can run one**, handing it only the spec
path and the rules to judge. A fresh reader judges a document more honestly than
its author, and the author is you: an agent that has just written a spec is the
party least able to notice its TL;DR overclaims. If your harness has no subagent,
judge them yourself, reading the spec from the top as though you had not written
it.

**At most three rounds.** An agent that cannot satisfy a rule in three attempts
is usually failing to understand the rule rather than the spec. If you run out,
hand over and say in one line which rules still fail — do not judge a rule you do
not believe just to reach 0.

`advisories` are reported and never block. `spec-language` is one of them, and it
is the contract talking: em dashes, attention-curating phrases, precision
theatre, hedged decisions. Clear it anyway. It cannot see aphorism or an
unlabelled sentence, so a clean report is a floor, not a pass.

The lint still exists and the gate is a superset of it; run
`node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" <htmlPath>` only when you want
the mechanical checks alone.

## 5. Hand off + arm the review watcher

- Print the spec `url` (open it to review). Edits to `htmlPath` live-reload.
- The spec is attached to this session; review comments submitted in the browser
  come back here automatically.
- **Arm the review watcher (once per session)** so comments are picked up even
  while you're idle. If it isn't already running this session, start it in the
  **background**: `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" wait-batch`.
  Its completion wakes the session with `{ ready, pending }` — on `ready`, run the
  review-spec flow for each `pending` spec, then relaunch it. It does not expire
  on its own: it runs until a batch arrives or this session ends. One watcher
  covers every spec attached here.

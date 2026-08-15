# SpecForge house rules

The conventions every SpecForge spec follows. `create-spec` reads this when
authoring; the **enforced** subset (required sections, theme contract, plan
structure) is checked by `lib/lint-spec.mjs`. The machine-readable defaults live
in `lib/config.mjs` and can be overridden per project at
`<project>/.specforge/config.json`.

## Format

- A spec is a **single self-contained `.html` file** — inline `<style>` and
  `<script>`, no external assets. It must open correctly straight from disk.
- Start from `templates/spec-base.html`. Keep its structure and section ids;
  fill in the `{{ … }}` placeholders.

## Required sections (enforced)

An implementation spec (`design-impl`, `impl`) must contain these
`<section id="…">` blocks:

`tldr`, `overview`, `goals`, `design`, `decisions`, `impl-plan`,
`task-tracker`, `impl-decisions`, `deviations`, `tradeoffs`.

Optional but encouraged: `open-questions`, `appendix`.

A `general` spec has no required section but `tldr`. It is the type for a
document none of the others describe, and its sections come from the use case
(or, for a converted file, from the source's own headings). Everything else on
this page still applies to it: stable unique ids, the theme contract, the palette
tokens, `data-sf-section` on every section, and the TOC kept in sync.

`impl-decisions`, `deviations`, and `tradeoffs` start as empty stubs — they are
filled **during implementation**, not at authoring time.

> The authoritative list is `requiredSections` in `lib/config.mjs` / project
> config, so it can change without editing this file.

## Open questions (gate at implementation time)

Each open question is `<li data-sf-q="open">…</li>`. When it's settled, change
the attribute to `data-sf-q="resolved"` (or `"dropped"`). The
**pre-implementation gate** refuses to start implementing while any
`data-sf-q="open"` remains — open questions must be resolved first.

## Theme contract (enforced)

The spec must support a seamless light/dark switch:

- CSS custom properties under `:root{ --bg: … }` (dark default).
- A `:root[data-theme="light"]` override block.
- A `@media (prefers-color-scheme: light)` block so OS preference is honored.
- A toggle that flips `data-theme` and persists to `localStorage`.

`spec-base.html` already satisfies this — don't remove it.

## Palette tokens (enforced)

Use the **canonical palette tokens** for every color — don't invent per-spec names
(`--card`, `--ecru`, `--redbg`, …). The review layer's theme variants re-tint a spec
by overriding exactly these tokens, so a spec that strays into its own dialect won't
re-theme cleanly. The lint requires all of them to be defined:

| Token | Role | | Token | Role |
|-------|------|-|-------|------|
| `--bg` | page background | | `--accent` | links / primary accent |
| `--panel` | card / panel surface | | `--green` | good / success (tags, callouts) |
| `--panel2` | elevated / alt surface | | `--amber` | warning |
| `--ink` | primary text | | `--red` | bad / danger |
| `--muted` | secondary text | | `--code` | code-block background |
| `--line` | borders / dividers | | `--shadow` | shadow color |
| `--mono` | monospace font stack | | | |

Define each under `:root` (dark) with a `[data-theme="light"]` override (as
`spec-base.html` does). Need a tint (e.g. a colored callout fill)? Derive it from a
token — `background: color-mix(in srgb, var(--amber) 16%, var(--bg))` — rather than
adding a new color token. The list is `PALETTE_TOKENS` in `lib/config.mjs`, fixed
house-wide (the lint enforces exactly this set).

## Implementation plan (enforced structure)

Use the structured markup so the tracker and enforcement hooks can read it:

```html
<li data-sf-stage="1" data-sf-pr="">
  <div class="sh"><h3>Stage 1 — Name</h3><span class="tag todo">todo</span></div>
  <ul class="sf-tasks">
    <li data-sf-task="1.1" data-sf-status="todo">Task<span class="verify">verify: …</span></li>
  </ul>
</li>
```

`data-sf-status ∈ { todo, in_progress, done, blocked, deferred, dropped }`.
One stage = one PR. Write tests first.

## Markdown interop (the SF-MD dialect)

A spec exports to GitHub-flavoured markdown and imports back from it
(`specforge export-md` / `import-md`, `lib/html-to-md.mjs` / `lib/md-to-html.mjs`).
The dialect is ordinary GFM: it must render on GitHub with no plugins.

Structure markdown cannot carry rides in YAML frontmatter (`title`, `type`,
`status`, `specforge_id`, `exported_at`) and in HTML comments, which every
renderer drops silently. **Markers are written only where they are load-bearing**,
so most sections carry none:

| Marker | Written when |
|---|---|
| `<!-- sf:section id="…" -->` | the heading slug does not reproduce the section id. It sits UNDER its heading and names that section. The comparison ignores a leading display ordinal, so `3 · Design` matches `design` |
| `<!-- sf:task id="…" status="…" -->` | a task status a checkbox cannot express. `done` and `todo` ARE the checkbox |
| `<!-- sf:stage id="…" pr="…" -->` | the stage id is not readable from its `Stage N ·` heading |
| `<!-- sf:svg id="…" -->` | a lifted diagram's identity |
| `<!-- sf:callout variant="…" -->`, `<!-- sf:box class="…" -->` | a callout variant, a panel or card |
| `<!-- sf:q state="dropped" -->` | an open question that was dropped (open and resolved are the checkbox) |

Rules that hold in both directions:

- **Diagrams leave as files.** GitHub strips inline SVG, so each one is written
  to `<name>.assets/<section-id>-<k>.svg` and referenced as an image. On the way
  back it is inlined again: a spec is a single self-contained file.
- **An imported spec inlines every asset.** SVG verbatim, rasters as base64 data
  URIs, capped at 512 KB; anything larger is dropped and named in the report.
- **Imported markdown is untrusted.** Raw HTML is sanitized and every URL is
  checked against a scheme allow-list, because the daemon serves the result in a
  browser with no second pass behind it.
- **Import always creates a new spec.** A `specforge_id` in frontmatter is
  provenance (`meta.derivedFrom`), never a write target.
- **The task tracker is not exported.** It is a projection of the plan and is
  regenerated on import.

## Language (contract)

Full contract: `references/spec-language.md`. Read it before writing prose. The
short form:

- Every sentence carries a **decision** (with its criterion), a **measurement**
  (value, unit, method, date), a **source** (retrieval date, confidence), an
  **assumption** (with what falsifies it), or a **specification** (type,
  threshold, constraint, behaviour). A sentence carrying none gets cut.
- **No aphorisms.** If a line works as a standalone tweet, cut it.
- **No em dashes**, attention-curating phrases ("worth noting", "importantly"),
  hedged decisions ("probably"), precision theatre ("typically 1 to 3"), metaphor
  about the system, or meta-narration about the document.
- **Write unknowns down.** An omitted threshold reads as "no threshold"; a
  described enum reads as "the list is open".
- Assume the reader has agreed to the direction. Spend words on resolution, not
  persuasion.

`lint-spec.mjs` reports the mechanical subset as the advisory `spec-language`
check. A clean report is a floor: it cannot see aphorism or an unlabelled
sentence.

## Presentation

Use the **component library**. Every spec carries its stylesheet as a stamped
block, so the classes are available without importing anything.

**The rules live in [`references/spec-components.md`](../references/spec-components.md)** —
34 components, each with the rule for when it applies and what a well-formed one
must contain. Read it before writing. It is generated from `components/`, so it
is never out of date with what the stylesheet defines.

The one rule worth repeating here: **pick a component by what the block
asserts**, never by how it should look. A notice takes a type (`decision`,
`assumption`, `risk`, `deviation`, `constraint`, `note`, `warning`, `danger`,
`tip`, `success`, `example`, `quote`) and its tone follows from the type. A
notice with no type, or with a tone class used directly, is a lint warning.

Prefer tables and short notices over long paragraphs, and keep notices to about
one per 400 words: emphasis everywhere is emphasis nowhere.

**The stamped block is generated.** It sits between
`/* specforge:components v1 start */` and `/* specforge:components end */` at the
top of a spec's `<style>`. Do not edit it; a spec's own rules come after it and
win. `specforge components sync <id>` brings a spec up to the current version.

## Code blocks

**Declare the language on a block that is code in one.** The review layer
highlights it; a block with no language is served exactly as written.

```html
<pre data-lang="python"><code>…</code></pre>
<div class="codeblock" data-lang="yaml">…</div>   <!-- on the wrapper works too -->
<pre><code class="language-sql">…</code></pre>  <!-- so does Prism's own class -->
```

Built-in: `python`, `yaml`, `json`, `javascript`, `typescript`, `bash`, `sql`,
`diff`, `markup` (HTML), `css`. Anything else is left as plain text rather than
guessed at.

**Do not declare one on a block that is not code.** About half the code blocks in
the store are ASCII data-flow diagrams, pseudo-code carrying prose annotations, or
structural sketches that resemble JSON without being it. Highlighting those
colours a box-drawing character as an operator and a comment as a string, which
reads worse than no highlighting at all. Leave them undeclared; that is the
supported way to say "this is not a language".

Highlighting is a review-layer feature, so it applies to a spec the daemon serves
and to a published copy. A spec opened straight from `file://` shows plain code,
the same trade the theme variants and the comment rail already make.

## Naming

`{date}-{slug}-spec.html` (e.g. `2026-06-02-payment-retries-spec.html`), written
to the configured specs dir (default `<project>/specs`).

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

Every spec must contain these `<section id="…">` blocks:

`tldr`, `overview`, `goals`, `design`, `decisions`, `impl-plan`,
`task-tracker`, `impl-decisions`, `deviations`, `tradeoffs`.

Optional but encouraged: `open-questions`, `appendix`.

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

## Presentation

Reuse the house components from the template: `.panel`, `.card`, `.tag`
(`.accent/.good/.warn/.bad/.todo/.done`), `.callout`, tables, the sticky TOC.
Keep prose tight; prefer tables and short callouts over long paragraphs.

## Naming

`{date}-{slug}-spec.html` (e.g. `2026-06-02-payment-retries-spec.html`), written
to the configured specs dir (default `<project>/specs`).

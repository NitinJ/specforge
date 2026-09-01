---
name: tune-templates
user-invocable: true
description: |
  Optimize the SpecForge spec templates from the review-comment history. Use when
  the user asks to "tune the templates", "improve the spec templates", "bake review
  learnings into the templates", or after a batch of specs has accumulated feedback.
  Mines every human comment across the store, clusters the recurring cross-spec
  themes + redundant sections, proposes template changes as a spec, and — only on
  the user's go-ahead — edits the template specs in place, one per spec type.
  Never touches or rewrites existing specs; templates only.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# tune-templates

Turn the review-comment history into better templates. The templates are the
per-type spec shells, one `template-<type>` per kind of spec, stored — and
edited — as ordinary specs. Editing a template spec changes what every future
spec of that type scaffolds from.

**Read the list at run time, never from memory:**

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-types-cli.mjs"
```

Six kinds ship with the plugin and the user can add more from the configuration
page, so the list is not knowable when this file is written. Enumerating it here
is how a type gets silently skipped.

`template-general` is deliberately section-free: tune its chrome and its authoring
comment, never add sections to it.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory. Templates live in the
store at `~/.specforge/specs/template-<type>/spec.html`; the bundled seeds are at
`${CLAUDE_PLUGIN_ROOT}/templates/spec-base-<type>.html` (fallback + fresh-install).

**Scope rule (non-negotiable):** this skill edits templates only. It never touches,
rewrites, or lints existing specs. The recurring themes become template scaffolding,
not retroactive edits.

## 1. Learn — mine the comment corpus

```
node "${CLAUDE_PLUGIN_ROOT}/lib/mine-comments.mjs" --json
```

Every human-authored comment across the store, keyed to its spec (title/type) and
the section it anchored to. Agent replies are excluded. Cluster them into recurring
**cross-spec** themes — weight spread (how many distinct specs carry a theme) over
raw count, because the goal is to bake in what comes up "again and again across many
specs", not one loud spec. Also look for **redundant sections**: shapes the templates
scaffold that the human keeps deleting or collapsing.

The canonical first run of this analysis is spec `cbc766178e` ("Template Learnings —
What 588 Review Comments Teach Us") — read it for the 13 themes (T1..T13) and the
structural defects already found. On a re-run, diff new themes against it.

## 2. Propose — discuss via a spec, never edit silently

Author the proposal as a **research** spec (via the create-spec flow), one theme to
one concrete template change, with an evidence index back to the comments. Present:

- the ranked themes (spread + representative quotes),
- redundant / missing sections per template,
- the exact change proposed for each template the command above lists, the user's
  own types included (a kind added from the configuration page appears there
  without this file changing). For `template-general` the proposal covers chrome
  and the authoring comment only, since adding sections to it would defeat the
  type,
- open questions the user must decide.

Attach it and **wait for the user's decisions**. Do not proceed to §3 until they
have reacted. This mirrors how `cbc766178e` was reviewed.

## 3. Apply — edit the template specs in place

Only on the user's go-ahead, and only for the changes they approved:

1. Edit `~/.specforge/specs/template-<type>/spec.html` with the Edit tool. Keep every
   `<section id="…">` and its id, the theme CSS, the palette tokens, and the floating
   TOC (update TOC entries + section numbers together). Follow the house rules the
   themes encode: lead with the number, prefer tables/cards/diagrams over prose,
   crisp headings with no flair, present the number then explain.
   Template prose sets the register for every spec written from it, so it is held
   to the language contract twice over:
   `${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`. A placeholder that models
   an aphorism, an em dash or a hedge teaches every future spec to copy it.
2. Lint each edited template — must pass:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" "~/.specforge/specs/template-<type>/spec.html"
   ```
3. Sync the bundled seed so fresh installs match: mirror the finalized template into
   `${CLAUDE_PLUGIN_ROOT}/templates/spec-base-<type>.html` (a per-type seed wins over
   the shared doc/impl shell — see `lib/store-templates.mjs` `bundledShell`).
4. Restart the daemon so the running server serves the edited templates:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" start
   ```

`ensureTemplates` never overwrites an existing store template, so edits survive a
reseed. Templates are protected from deletion; they stay attachable so they can be
reviewed and tuned exactly like this.

## 4. Guard — commentability advisory

The lint carries an advisory `commentability` check (T7): it warns, without failing,
when a spec traps text directly inside a bare `<div>` that the review layer cannot
anchor a comment to. It is advisory at authoring time and **never edits a spec** —
the fix is to wrap trapped text in a `<p>`/`<li>` or a commentable
`.card`/`.panel`/`.stat`/`.callout`. When authoring or tuning, aim for a clean
`commentability` line.

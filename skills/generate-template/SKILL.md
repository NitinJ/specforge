---
name: specforge:generate-template
user-invocable: false
description: |
  Write a spec template from a prompt. Auto-invoked when the owning session's
  Stop/UserPromptSubmit hook surfaces a queued template generation (the human
  clicked "Add a template" on the configuration page). Turns their description of
  the sections and when the kind should be used into the template spec's HTML,
  lints it, and reports back. The human is watching a dialog until this finishes.
allowed-tools: Read, Write, Edit, Bash
---

# generate-template

The human named a new kind of spec and described it in one prompt. A template
spec already exists at `~/.specforge/specs/template-<slug>/spec.html`, holding
the bundled shell for its family. **Your job is to replace that shell's sections
with the ones the prompt describes**, keeping everything the shell owns.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory.

**Someone is waiting on a dialog with a stated ETA.** Do this now, in one pass,
and report back. A template that is roughly right and arrives is worth more than
one that is exactly right and does not: the human's next move is to comment on
the sections and refine them, which is the whole point of landing them on a spec
page.

## 1. Read the request

The hook message lists each template spec **id** and the **prompt**. To read it
again, or for a manual run:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec ~/.specforge/specs/<id>/spec.html
```

The prompt is on the spec's meta at `~/.specforge/specs/<id>/meta.json` under
`generate.prompt`. It describes three things, though rarely in this order:

- **the sections** the kind should have
- **when the kind should be used** (this is already stored on the kind's
  registry row; the prompt is where it came from)
- **the name**, which is already the slug and needs nothing from you

## 2. Read the shell you are editing

```
node "${CLAUDE_PLUGIN_ROOT}/lib/spec-nav-cli.mjs" map --spec ~/.specforge/specs/<id>/spec.html
```

The shell is one of two families and the choice is already made:

- **doc** — chrome, a TL;DR, and prose sections. No plan machinery.
- **impl** — the same plus `impl-plan`, `task-tracker` and the Runtime stubs.

**Do not change the family.** If the prompt asks for stages and the shell has
none, add ordinary sections for them rather than reaching for the plan markup;
the human chose the family on the form and can change it by asking.

## 3. Write the sections

Replace the shell's placeholder sections with the ones the prompt describes.
Keep, without exception:

- everything in `<head>`: the title, the theme CSS, the component library block
- `<nav class="toc">`, with its links rewritten to match your sections
- one `<section id="...">` per section, each id **stable, unique and lowercase**
  (anchors and comments key off them)
- the canonical palette tokens. Colour only through them; the lint enforces it
- the `{{ … }}` placeholder convention **inside** each section, because this is a
  template: a section's body describes what an author should write there, in the
  same voice the existing templates use

Rules for the sections themselves:

- **One section per distinct thing the prompt names.** Do not merge two into one
  because they are short, and do not invent a third because the shell had one.
- **Order them the way the document is read**, not the way the prompt listed
  them. A summary goes first whatever position it was mentioned in.
- **Give each a one-line `<p class="sub">`** saying what belongs in it. This is
  what an authoring agent reads.
- Prose you write follows the language contract at
  `${CLAUDE_PLUGIN_ROOT}/references/spec-language.md`: no em dashes, no
  aphorisms, no hedged decisions, every sentence carrying something.

If the prompt is vague about a section, write the section anyway with a
placeholder saying what it is for. An absent section is invisible; a thin one
gets commented on and fixed.

## 4. Lint before reporting

```
node "${CLAUDE_PLUGIN_ROOT}/lib/lint-spec.mjs" ~/.specforge/specs/<id>/spec.html --project "${CLAUDE_PLUGIN_ROOT}"
```

Fix and re-run until `PASS`. **Do not report a template that fails the lint**:
every spec created from it inherits the failure. The `spec-language` line is
advisory and never fails the lint; clear what it names anyway.

## 5. Report back

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" template-done <id>
```

The dialog the human is watching navigates them to the template the moment this
lands.

If it genuinely cannot be written (the prompt describes no sections at all, the
shell is unreadable, the lint cannot be cleared):

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" template-done <id> --error "<short reason>"
```

The dialog shows the reason and offers to open the template anyway, which is
still the working shell it started as. **Always report one or the other.**
Reporting nothing leaves the human on a spinner until it times out.

## 6. Tell the human

One or two lines: which kind you wrote, and the sections you chose. They are
about to read it.

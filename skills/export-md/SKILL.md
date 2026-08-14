---
name: specforge:export-md
user-invocable: true
description: |
  Export a spec from the store as a GitHub-flavoured markdown file, plus a
  sidecar directory holding its diagrams. Use when the user asks to "export this
  spec as markdown", "give me the .md", "put this spec in the repo", or wants a
  spec on a surface that speaks markdown (GitHub, an editor, another agent). The
  conversion is deterministic and needs no model: this skill picks the spec,
  runs the CLI, and reports where the file landed.
allowed-tools: Read, Bash, Glob
---

# export-md

Render a store spec as markdown. `${CLAUDE_PLUGIN_ROOT}` is the installed plugin
directory.

## 1. Pick the spec

A store id is ten lowercase hex characters (`sha1(uuid)[:10]`), or `template-<type>`
for a template spec. **Check `$ARGUMENTS` against that shape before it goes
anywhere near a shell.** Anything else is not an id, whatever it looks like: treat
it as a description and find the real id with

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" list
```

which is also what to run when `$ARGUMENTS` names no spec at all. List, then ask
which one, unless exactly one spec is attached to this session.

## 2. Export

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" export-md "<id>" [--out "<dir|file.md>"]
```

`--out` takes a directory (the file is named from the spec title) or a path
ending in `.md`. Omitted, it writes into the current directory.

**Both placeholders are filled from what the human typed, so treat them as data.**
Quote them, as above: a destination with a space in it otherwise arrives as two
arguments and the export lands somewhere else.

Quoting is not sanitising. Double quotes stop word splitting but NOT substitution,
so `$`, a backtick, `;`, `|`, `&` or a newline still run inside them. The id is
checked against its shape in step 1, which leaves the path: if it carries any of
those characters, do not paste it into the command. Ask for a plain path, or write
to a directory you choose and tell the human where it went. The CLI validates its
arguments, but only after the shell has had its turn with them.

It prints `{ id, mdPath, assetsDir, assets, warnings }`:

- **`assetsDir`** is set when the spec has diagrams. They are written next to the
  `.md` as SVG files and referenced as ordinary images, because every markdown
  renderer strips inline SVG. **The folder has to travel with the file** — a `.md`
  moved on its own keeps its links but loses the pictures.
- **`warnings`** names anything the conversion could not carry faithfully (a
  table cell that held a list, an element with no markdown form). Empty is the
  normal case; if it is not empty, say what it says.

A `deck` spec exits non-zero: slides are not a linear document, and flattening
them is not something this does.

## 3. Report

Give the human the path, and mention the assets folder when there is one. Do not
paste the markdown into the conversation: the file is the deliverable, and a spec
is long.

## Notes

- Nothing is written into the store. The markdown is a rendering of `spec.html`
  at the moment you asked, so re-exporting after an edit is how you refresh it;
  there is no stale copy to invalidate.
- The reverse direction is `/specforge:convert <file.md>`, which imports markdown
  as a **new** spec and never writes over an existing one.

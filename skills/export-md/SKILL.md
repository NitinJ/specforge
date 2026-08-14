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

If `$ARGUMENTS` names an id, use it. Otherwise list what this session owns and
ask which one, unless exactly one spec is attached:

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" list
```

## 2. Export

```
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" export-md "<id>" [--out "<dir|file.md>"]
```

`--out` takes a directory (the file is named from the spec title) or a path
ending in `.md`. Omitted, it writes into the current directory. Quote it: a
destination with a space in it otherwise arrives as two arguments and the export
lands somewhere else.

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

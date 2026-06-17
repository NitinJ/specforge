---
name: specforge:list-specs
description: |
  List SpecForge specs — either every spec in the store (mode "all") or just the
  specs attached to this session (mode "mine"). Use when the user asks to "list
  specs", "show all specs", "what specs do I have open", or wants to open/detach a
  spec. Starts or reuses the daemon and prints a table with the index URL.
allowed-tools: Read, Bash
---

# list-specs

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory.

## Run the CLI

- **All specs** (mode "all"): `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" listall`
- **This session's specs** (mode "mine"): `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" list`

Both ensure the daemon is up. `listall` also prints `indexUrl`.

## Present the result

- Render the JSON `rows` as a compact table: **id · title · status · attached**
  (`attached` is a session id, or `free`).
- For "all", give the `indexUrl` to open in the browser — the index links each
  row to `/spec/<id>`.
- To **open** a free spec in this session: `… specforge-cli.mjs open <id>` (attaches
  it; fails if another live session holds it).
- To **detach** a spec from this session: `… specforge-cli.mjs detach <id>` (or click
  it on the index page).

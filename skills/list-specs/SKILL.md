---
name: specforge:list-specs
user-invocable: false
description: |
  List SpecForge specs — either every spec in the store (mode "all") or just the
  specs attached to this session (mode "mine"). Use when the user asks to "list
  specs", "show all specs", "what specs do I have open", or wants to open/detach a
  spec. Starts or reuses the daemon, prints a table, and offers to open/detach.
allowed-tools: Read, Bash, AskUserQuestion
---

# list-specs

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory.

## Run the CLI

- **All specs** (mode "all"): `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" listall`
- **This session's specs** (mode "mine"): `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" list`

Each returns `session` (this session's id) plus `rows`
(`{ id, title, status, attached }`, where `attached` is a session id or `free`).
`listall` also ensures the daemon is up and returns `indexUrl`; `list` reads
straight from the store (no daemon needed). The picker's actions handle the
daemon themselves: `open` starts it when needed and returns a URL, while `detach`
is store-only — so both work whether or not the daemon was already running.

## Present the result

Render `rows` as a compact, numbered table — **# · id · title · type · status · attached** —
showing `attached` as `free`, `this session`, or `held: <first 8 of the id>`. For
"all", also print `indexUrl` (the browser index links each row to `/spec/<id>`).

## Then offer to open / detach (the picker)

Classify each row against `session`:

| `attached` | meaning | action |
| --- | --- | --- |
| `free` | unattached | **open** (attach to this session) |
| equals `session` | attached here | **detach** |
| any other id | held by another live session | none (show it greyed) |

If at least one row is actionable, call **AskUserQuestion** ("Open or detach a spec?").
AskUserQuestion allows **4 options max**, so offer up to **3** actionable specs plus a
**"Just viewing"** option (4 total):

- free specs → label `Open · <title>` (use `<id8>` if untitled)
- this session's specs → label `Detach · <title>`
- always include **"Just viewing"** (does nothing)

The user can also pick **"Other"** (always available) and type any id from the table.
If more than 3 rows are actionable, show the 3 most useful (free specs first) and note
that "Other" accepts any id.

Act on the choice:

- **Open `<id>`** → `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" open <id>`
  (attaches it to this session; fails if another live session holds it). Print the
  returned `url`.
- **Detach `<id>`** → `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" detach <id>`.
  Confirm it's freed.
- **Other `<id>`** → open it if free, detach it if it's attached here, else say it's
  held by another session.
- **Just viewing** → stop, no action.

Skip the picker when nothing is actionable. In "mine" mode with no rows, say no spec
is attached to this session and point to `/specforge:listall` to open one.

# Adding an agent CLI

SpecForge runs inside an agent CLI. Claude Code and Pi are supported; adding a
third costs **two files and one line**, and nothing under `lib/` core, `server/`,
`components/` or `templates/` changes.

This page is what makes that claim checkable by a person. The scan that checks it
mechanically is `npm run check:harness`, run in CI on every pull request.

## What a harness is

A record with five fields, in `lib/harness/<id>.mjs`:

| Field | Type | Answers |
|---|---|---|
| `id` | string | Which CLI. Prefixes every session key: `pi:8f3c...` |
| `agentName` | string | What a reply is signed with, and a name people may not register under |
| `sessionKey(ctx)` | `(ctx) => string` | Which conversation this is |
| `workRef(workId)` | `(id) => string` | How a Notice names a unit of work: `/specforge:review-spec`, `/skill:review-spec` |
| `reentered(ctx)` | `(ctx) => boolean` | Whether this settle already followed a Notice |

Plus a `detect(env)` export: is this process running inside that CLI?

`ctx` is `{ payload, env }`, the CLI-native event payload and the environment. A
resolver reads whichever it needs, and reads nothing else.

## What SpecForge asks a CLI for

Three moments, and nothing more. Every CLI names them differently; the binding is
where the names are translated.

| SpecForge | Claude Code | Pi |
|---|---|---|
| `session_start` | `SessionStart` hook | `session_start` event |
| `turn_start` | `UserPromptSubmit` hook | `before_agent_start` event |
| `turn_settled` | `Stop` hook | `agent_settled` event |

`turn_settled` must be the moment the CLI will not continue on its own. Pi's
`agent_end` is not that moment: an auto-retry, an auto-compaction or a queued
follow-up can still run after it.

Each handler calls `onEvent(event, ctx)` from `lib/harness/policy.mjs` and gets
back a **Notice** or `null`:

```js
{ text: string, mustAct: boolean }
```

`mustAct` means the session may not settle until it has acted. Claude Code
expresses that as `{ decision: 'block', reason }`; Pi expresses it as
`sendMessage(..., { deliverAs: 'followUp', triggerTurn: true })`. A plain Notice
is context, delivered however the CLI delivers context.

`policy.mjs` names no CLI, and a CI check fails the build if one appears in it.
Every decision about when SpecForge speaks lives there, so a new CLI inherits all
of it and can change none of it by accident.

## The three edits

### 1. The adapter

`lib/harness/<id>.mjs`, exporting the record and `detect`. Copy
`lib/harness/pi.mjs` and answer the five questions for your CLI.

Two rules:

- **Import nothing from the CLI.** This file is also what a subprocess loads when
  the CLI's bash tool runs `specforge <verb>`, and that process has no CLI
  runtime in it.
- **Never throw.** A resolver that cannot answer returns `''` or `false`. Every
  caller's next move is the same: own nothing, do nothing.

### 2. The binding

`extensions/<id>.js`, or whatever shape the CLI loads. Translation only: call
`onEvent`, render the Notice in the CLI's vocabulary, swallow every error. Look
at `extensions/specforge.js` and `hooks/*.mjs`, which are the same 40 lines
written twice.

A SpecForge bug must never wedge somebody's session. Wrap every handler.

### 3. The registry line

`lib/harness/index.mjs`:

```js
const ADAPTERS = [
  { record: pi, detect: detectPi },
  { record: yours, detect: detectYours },   // <- the one line
  { record: claude, detect: detectClaude }, // last: also the fallback
];
```

Claude Code stays last. It is the fallback for an unrecognised environment, and a
marker-based detector running ahead of the others would claim a session belonging
to a CLI that merely inherited a stale `CLAUDE_CODE_SESSION_ID` from a parent
shell. Put yours above it.

## What you get for free

- **Comment addressing.** People write `@agent`. SpecForge resolves it to
  whichever harness is working the spec, so no reader learns a new word and no
  spec is addressed to a CLI that has gone.
- **Reply attribution.** Replies are signed `agentName` and styled as an agent by
  `kind`, not by name.
- **The switcher.** Connect your CLI to a spec another one is working, and the
  spec header lists both with the reader choosing. Routing, the write gate and
  per-connection liveness all follow the choice.
- **`specforge doctor`.** Reports your harness, your session key, the specs you
  are connected to and who is working each.

## Checking it

```sh
npm run check:harness    # 0 hits outside lib/harness/, hooks/ and extensions/
npm test                 # the policy suite runs against a fake harness
specforge doctor         # inside your CLI: does it name itself?
```

The scan looks for four things, and only these: reading one CLI's environment
variables, rendering one CLI's address for a skill, speaking one CLI's hook
protocol, and naming one CLI's event vocabulary. The word "claude" is not one of
them, because `LEGACY_HARNESS = 'claude'` is the whole of the pre-migration read
path and always will be.

The adapter's own tests import nothing from the CLI. `test/helpers/fake-pi.mjs`
is the pattern: an object that records what was registered and what was sent, so
the translation is asserted without the CLI installed.

## Installing

`install.sh` installs into every CLI it finds on PATH and prints a line per CLI,
including the ones it did not find. Add a detection branch there and a row to the
table in `README.md`.

Package manifests live beside each other rather than in separate repositories:
`.claude-plugin/plugin.json` for Claude Code, the `pi` block in `package.json`
for Pi. One checkout serves every CLI.

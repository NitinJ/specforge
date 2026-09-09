# Codex capability record

Status: verified implementation input
Checked: 2026-09-08
Repository baseline: `f20f2f7fc493f11869ab740e34cc302dce6a1c8b`
Local CLI: `codex-cli 0.153.4`

## Supported target

SpecForge targets Codex CLI and the Codex desktop app. Both use the same plugin archive, skills, hook scripts, store, daemon, and browser UI. Client-specific code is limited to protocol translation.

The release uses the user's existing Codex authentication. SpecForge does not call the OpenAI API and does not require an API key.

## Reproduction record

The CLI checks were run from the repository worktree on 2026-09-08:

```text
$ codex --version
codex-cli 0.153.4

$ env | rg '^(CODEX_SESSION_ID|CODEX_THREAD_ID)='
CODEX_SESSION_ID=<same UUID as CODEX_THREAD_ID>
CODEX_THREAD_ID=<same UUID as CODEX_SESSION_ID>

$ codex plugin --help
Commands: add, list, marketplace, remove

$ codex plugin marketplace --help
Commands: add, list, upgrade, remove
```

The local Codex process supplies a stable thread identifier to ordinary shell
commands through `CODEX_THREAD_ID` and `CODEX_SESSION_ID`. Shared code will
prefer an explicit CLI or hook value, then `SPECFORGE_SESSION_ID`, then these
Codex variables, then `CLAUDE_CODE_SESSION_ID`. Skill commands therefore do not
depend on plugin-root variables for identity.

Desktop hook payload capture, hook trust, and desktop app behavior remain Stage
5 release gates. Until those checks pass, desktop support remains unresolved.

The Stage 2 installed-candidate probe resolved two CLI questions:

```text
$ ./install.sh --harness codex --plugin-only
Installed plugin root: ~/.codex/plugins/cache/specforge/specforge/0.8.0+codex.<content-hash>

$ ./install.sh --harness codex --plugin-only
Added plugin specforge from marketplace specforge at the new content-hash version

$ codex exec ... '$specforge:review-spec ...'
Loaded skill: specforge:review-spec
PLUGIN_ROOT: unset in ordinary skill shell commands
CLAUDE_PLUGIN_ROOT: unset in ordinary skill shell commands
CODEX_THREAD_ID: set
CODEX_SESSION_ID: set
```

The `SessionStart` adapter therefore supplies the exact installed runtime root
as developer context. One canonical skill tree keeps the compatibility token in
its examples; Codex substitutes the supplied path. A clean-thread probe used
that path to run the shared `specforge-cli.mjs actions` command from `/tmp` and
returned all 17 actions. The probe used the signed-in Codex provider and did not
set or request an OpenAI API key.

The same installer command succeeded twice against Codex 0.153.4. `plugin add`
installed the second content-hash version in place. The installer retains the
previous validated marketplace and restores it automatically if a later
`plugin add` fails.

## Verified host contracts

| Capability | Contract | Evidence |
| --- | --- | --- |
| Plugin entry | `.codex-plugin/plugin.json` identifies the package | [Plugin packaging](https://developers.openai.com/plugins/build/plugins) |
| Skills | A plugin can expose skill directories from one shared `skills/` tree | [Plugin packaging](https://developers.openai.com/plugins/build/plugins) |
| Hooks | Codex discovers `hooks/hooks.json` at the plugin root | [Plugin packaging](https://developers.openai.com/plugins/build/plugins) |
| Plugin location | Hook commands receive `PLUGIN_ROOT` and `PLUGIN_DATA`; Codex also provides `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` compatibility aliases | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Session identity | Hook input contains `session_id`; turn hooks also contain `turn_id` | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Start context | `SessionStart` can add developer context | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Prompt context | `UserPromptSubmit` can add context before a turn | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Settle continuation | A synchronous `Stop` hook can return `decision: "block"` and a reason | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Continuation guard | The next `Stop` input contains `stop_hook_active: true` after a Stop continuation | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Session cleanup capability | `SessionEnd` runs for the main thread when Codex closes the conversation or after its documented idle closure; SpecForge must register it before claiming cleanup support | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Hook trust | Installed hooks do not run until the user trusts their current definition | [Hooks](https://learn.chatgpt.com/docs/hooks) |
| Marketplace commands | The local CLI exposes marketplace add/list/upgrade/remove and plugin add/list/remove | `codex plugin --help` on the version above |

## Delivery result

Codex background hooks cannot start a turn after the thread becomes idle. Their output waits for the next user turn. A long-running shell command can remain part of an active turn, but that is an active review mode, not settled-thread delivery.

Codex delivery uses the following native paths:

1. Pending browser work is injected on the next user prompt or before the current turn settles.
2. An explicit `review-wait` checks queued work once and returns immediately. It does not keep the turn open or start a watcher.

The browser reports Codex as **Review queued** while idle and **Reviewing** during an acknowledged round.

Canonical skills use one harness-neutral `specforge review-wait` operation. Pi keeps its extension-owned child, Claude keeps its background-task flow, and Codex performs a one-shot check. An idle Codex result is `{ ready: false, pending: [], reason: 'next-turn' }`. The agent finishes its turn without re-arming. Stop hooks still route submitted work, but never block an idle Codex turn just to request a watcher.

Skill text, hook routes, and browser recovery prompts must agree on this behavior. None may tell Codex to launch a foreground or background watcher. Tool sandboxes can each report PID 2, so the runtime ignores legacy Codex PID records when calculating browser readiness. This removes Codex's reliance on process IDs across namespaces.

Full settled-thread wake-up remains unavailable through the documented native plugin hook contract. An App Server client can own a separate thread and call `thread/resume` plus `turn/start`, but it must not take over a thread owned by another Codex client. SpecForge does not add that separate client in this implementation.

The shared runtime now implements this contract through `specforge review-wait`.
It detects review batches, template-generation requests, and exports without
changing their state. The relevant skill acknowledges pickup with
`batch-working`, `template-working`, or `export-working`, so a lost hook or tool
result remains deliverable. Claude and Pi delivery workers retain opaque leases;
late cleanup from an older process cannot clear its replacement. Codex checks
neither acquire a lease nor write a heartbeat. Spec ownership remains keyed by
the native thread id.

Agent replies accept an effect key. Retrying the same batch/thread effect returns
the existing reply instead of appending it again, covering the side effect most
likely to be duplicated when a review turn is resumed after transport loss.

## Browser and recovery behavior

The browser derives Claude and Pi connectivity from a live worker and fresh
heartbeat. Codex uses next-turn delivery and reads **Review queued**, with a
one-shot continuation prompt for the owning thread. An acknowledged review
reads **Reviewing**. A legacy Codex heartbeat cannot advertise a live listener.

Replies retain their actual harness author, including `codex`, while all three
harnesses use the same stored comment and spec formats. Shared-origin rounds
remain reply-only for Codex under the same ownership rule used by Claude and Pi.
Reconnect guidance targets the recorded harness and requires an explicit detach
before another thread takes ownership.

Inspection does not claim review, generation, or export work. If hooks are
untrusted, a hook result is lost, the daemon stops, or the optional export
integration is unavailable, the request and browser draft remain available for
retry. Worker leases discard stale cleanup, and detaching the final spec clears
that session's delivery record.

## Event mapping

| Shared event | Claude Code | Pi | Codex |
| --- | --- | --- | --- |
| Session starts or resumes | `SessionStart` hook | `session_start` | `SessionStart` hook |
| Prompt is about to run | `UserPromptSubmit` hook | `before_agent_start` | `UserPromptSubmit` hook |
| Turn is settling | `Stop` hook | `agent_settled` | `Stop` hook |
| Session ends | Registered `SessionEnd` hook plus stale lease fallback | `session_shutdown` | Registered `SessionEnd` hook plus stale lease fallback |
| Active review wait | Background task | Extension-owned child | Foreground unified-exec child |

## Runtime and permissions

- Node 18 or newer remains the declared runtime.
- The installed plugin directory is treated as read-only.
- User data stays in `SPECFORGE_HOME` or `~/.specforge`.
- The daemon listens on loopback. Public sharing remains a separate Cloudflare setup.
- Hook denial or missing store access leaves browser work pending and reports recovery guidance.
- Hook commands may use Codex's documented `CLAUDE_PLUGIN_ROOT` compatibility alias during transition. New shared commands resolve the root from their module path or `PLUGIN_ROOT`; host identity comes from an explicit `SPECFORGE_HARNESS` value or a native session variable, never from an alias name.
- Ordinary Codex skill commands receive identity from `CODEX_THREAD_ID` or `CODEX_SESSION_ID`. They do not assume that hook-only plugin variables are present. Installed-candidate tests must verify the exact discovered skill names before user documentation is finalized.
- If one harness is launched inside another and both hosts' session variables are
  inherited, set `SPECFORGE_HARNESS` and `SPECFORGE_SESSION_ID` for the inner
  session. Native environment variables alone cannot identify which nested
  process owns an ordinary shell command.

## Qualification matrix

| Check | CLI | Desktop app |
| --- | --- | --- |
| Plugin installation and skill discovery | Required | Required |
| Hook trust and event payloads | Required | Required |
| Create/open/convert from installed cache | Required | Required |
| Next-turn pending-work pickup | Required | Required |
| Active review wait, two batches | Required | Required |
| Resume without duplicate ownership | Required | Required |
| Conversation close and restart clears or expires ownership | Required | Required |
| Settled session does not report a detached watcher as connected | Required | Required |
| ChatGPT authentication, no API key | Required | Required |

Automated tests establish package and adapter behavior. A clean-profile smoke test on each client establishes host compatibility. Full settled-thread wake-up is not claimed by this release.

## Release qualification

The 0.9.0 candidate was installed twice through the local marketplace on Codex
CLI 0.153.4. Both the initial install and repeat update resolved to the same
`0.9.0+codex.<content-hash>` version; the release builder derives the suffix from
the complete tree.

A new ephemeral Codex thread started from `/tmp`, outside the repository, loaded
`specforge:review-spec` from the installed cache and ran the installed shared CLI.
It reported 17 actions, both `CODEX_THREAD_ID` and `CODEX_SESSION_ID`, and no
`OPENAI_API_KEY`. The run used the existing signed-in OpenAI provider.

Automated release checks pass on the current Node runtime: 3,007 repository
tests, the five Codex browser review journeys, package validation, installer
update/rollback/removal fixtures, and the installed artifact smoke. The complete
browser corpus passes except for the Mermaid loader-count assertion that also
fails unchanged on `main`; every other browser file passes. CI now runs the
Codex contracts on Node 20/22, a dependency-free runtime check on Node 18, and
the serialized Playwright suite.

Codex desktop, hook trust interaction on a clean desktop profile, and native
settled-thread wake-up remain unqualified. The release is therefore advertised
as a Codex preview rather than full cross-client parity.

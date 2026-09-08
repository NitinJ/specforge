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

Hook payload capture, installed skill-name discovery, hook trust, and the
desktop app checks require an installed candidate. They are Stage 5 release
gates rather than verified Stage 0 facts. Until those checks pass, desktop
support and the exact installed invocation names remain unresolved gates.

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

Therefore the first Codex release supports two native paths:

1. Pending browser work is injected on the next user prompt or before the current turn settles.
2. The discovered review skill can keep its current turn active while it waits for the next browser batch. The wait is cancellable and does not issue repeated model requests while idle.

The browser must report the actual mode. It must not show settled native Codex sessions as connected after the active wait ends.

Canonical skills will call one harness-neutral `specforge review-wait` operation. The shared runtime selects the host behavior: Pi keeps its extension-owned child, Claude keeps its supported background-task flow, and Codex keeps the shell command open inside the current tool call. The Codex agent waits on that running command before ending its turn. This is the foreground transport; it requires no separate API request and produces no model traffic until the command returns.

Skill text and hook route text must use the same host-neutral operation. Neither may tell Codex to launch the old background watcher. The runtime must never turn a detached Codex watcher heartbeat into a connected browser badge. This remains one shared skill and one shared route generator with runtime capability wording, not a Codex copy.

Full settled-thread wake-up remains unavailable through the documented native plugin hook contract. An App Server client can own a separate thread and call `thread/resume` plus `turn/start`, but it must not take over a thread owned by another Codex client. SpecForge does not add that separate client in this implementation.

## Event mapping

| Shared event | Claude Code | Pi | Codex |
| --- | --- | --- | --- |
| Session starts or resumes | `SessionStart` hook | `session_start` | `SessionStart` hook |
| Prompt is about to run | `UserPromptSubmit` hook | `before_agent_start` | `UserPromptSubmit` hook |
| Turn is settling | `Stop` hook | `agent_settled` | `Stop` hook |
| Session ends | Process ancestry and stale lease | `session_shutdown` | Planned `SessionEnd` hook plus stale lease fallback |
| Active review wait | Background task | Extension-owned child | Foreground unified-exec child |

## Runtime and permissions

- Node 18 or newer remains the declared runtime.
- The installed plugin directory is treated as read-only.
- User data stays in `SPECFORGE_HOME` or `~/.specforge`.
- The daemon listens on loopback. Public sharing remains a separate Cloudflare setup.
- Hook denial or missing store access leaves browser work pending and reports recovery guidance.
- Hook commands may use Codex's documented `CLAUDE_PLUGIN_ROOT` compatibility alias during transition. New shared commands resolve the root from their module path or `PLUGIN_ROOT`; host identity comes from an explicit `SPECFORGE_HARNESS` value or a native session variable, never from an alias name.
- Ordinary Codex skill commands receive identity from `CODEX_THREAD_ID` or `CODEX_SESSION_ID`. They do not assume that hook-only plugin variables are present. Installed-candidate tests must verify the exact discovered skill names before user documentation is finalized.

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

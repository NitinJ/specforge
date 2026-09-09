# Codex support

SpecForge 0.9.0 adds a Codex preview using the same runtime, store, browser,
hooks, and canonical skills as Claude Code and Pi. The adapter records Codex
thread identity and translates Codex lifecycle events; it does not copy the
authoring or review workflow and does not call the OpenAI API.

## Support status

| Client | Install and skills | Authoring and browser review | Delivery after the turn settles |
| --- | --- | --- | --- |
| Codex CLI 0.153.4 | Qualified | Qualified | Browser-to-idle-thread delivery verified with the native CLI and a mock model |
| Codex desktop | Packaged from the same plugin | Automated contracts pass | Manual qualification pending |

Lifecycle hooks start or reuse one detached watcher for the attached thread.
The watcher polls the shared SpecForge queue and calls `codex queue` when work
arrives. The Codex queue service wakes the idle owning thread. This requires a
Codex version with that command and host access to its queue database.
`review-wait` remains a one-shot inspection command in agent tools. Do not keep
a terminal or tool call waiting for comments.

## Install

Use your normal signed-in Codex account. SpecForge requires no OpenAI API key.

```sh
git clone https://github.com/NitinJ/specforge
cd specforge
./install.sh --harness codex --plugin-only
```

The installer validates a complete release tree, creates a content-addressed
local marketplace under `~/.specforge/codex-marketplace`, and registers
`specforge@specforge`. When Codex displays the hook trust prompt, inspect and
approve the four scripts under `hooks/`. Start a new thread after installation.

Run the same command to update. The candidate is validated before registration;
if Codex rejects it, the installer restores the previous marketplace tree.

```sh
./install.sh --harness codex --plugin-only
```

To remove only the Codex registration and installed marketplace:

```sh
./install.sh --harness codex --remove
```

Removal preserves `~/.specforge`, existing specs, and Claude Code or Pi
installations. Local marketplace files can still be removed if the Codex CLI has
already been uninstalled.

## Use

Ask Codex in ordinary language to create, convert, list, or open a SpecForge
spec. Installed skills use the `specforge:` namespace. For example:

```text
Create a SpecForge design spec for the retry service and open it for review.
$specforge:start-specforge
$specforge:export-md
```

Once a spec is open, the browser connection badge reports the actual transport:

- **Connected**: the background delivery worker is running and renewing its heartbeat.
- **Reviewing**: the agent is processing the submitted round. A second thread
  cannot take ownership through this state.
- **Disconnected**: no attached delivery session is present; **Reconnect** copies
  explicit detach, attach, and delivery steps.

The review skill handles owner edits, shared reply-only rounds, inline replies,
and aside actions through the common store format. New replies are displayed as
`codex`; existing Claude Code and Pi replies retain their original attribution.

## Recovery and permissions

Browser work is inspected without being claimed. A denied hook, closed tool
call, daemon restart, or interrupted turn leaves the request queued. The watcher
retries failed queue commands. Successful deliveries are recorded separately
from pickup acknowledgements to avoid repeated messages while a batch waits.
Duplicate reply effects are ignored. Only the host-owned `codex-queue` worker
can advertise readiness; legacy tool-sandbox PID records cannot. Claude Code
and Pi retain their existing background delivery workers.

The worker log is `~/.specforge/sessions/<session-key>.json.codex-log`.
If delivery fails, its heartbeat expires and the browser reports Disconnected.
SessionEnd releases the worker; it exits on its next poll. The next SessionStart
or Stop hook starts a replacement. Hooks return without waiting for the worker.

The plugin cache is treated as read-only. Specs and delivery records live in
`SPECFORGE_HOME` or `~/.specforge`, and the daemon listens on loopback. Public
sharing and Google Docs export retain their separate Cloudflare and Google Drive
requirements.

If you launch one agent harness inside another and both native session variables
are inherited, set `SPECFORGE_HARNESS=codex` and
`SPECFORGE_SESSION_ID=<thread-id>` for commands in the inner Codex thread.

The qualification evidence and known host boundary are recorded in
[Codex capability record](codex-capabilities.md).

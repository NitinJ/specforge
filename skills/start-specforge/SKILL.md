---
name: start-specforge
description: Start or reuse the local SpecForge daemon and return its browser index URL. Use when the user asks to start, launch, or open SpecForge.
allowed-tools: Bash
---

# Start SpecForge

`${CLAUDE_PLUGIN_ROOT}` below denotes the installed plugin directory. Claude and
Pi export it; Codex provides the exact value in SpecForge SessionStart context.
Substitute that value in the shell command.

Run:

```sh
node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" start
```

Return the reported `url` as a clickable link. The command starts the daemon only
when needed and does not enable public sharing.

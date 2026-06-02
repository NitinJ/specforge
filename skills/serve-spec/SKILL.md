---
name: specforge:serve-spec
description: |
  Open a SpecForge spec in the browser review server. Use when the user asks to
  "serve", "open", "preview", or "review" a spec, or wants to leave comments on
  one. Boots (or focuses) the local Node review server, prints the URL, and opens
  the spec with the comment/review layer injected. Supports a hands-free watch
  mode.
allowed-tools: Read, Bash, Glob
---

# serve-spec

Start the SpecForge review server and open a spec for browser review.

> **Status:** stub — the server and this skill's behavior are implemented in
> Stage 2 (`server/start.mjs`). Watch mode arrives in Stage 5.

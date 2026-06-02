---
name: specforge:serve-spec
description: |
  Open a SpecForge spec in the browser review server. Use when the user asks to
  "serve", "open", "preview", or "review" a spec, or wants to leave comments on
  one. Boots (or focuses) the local Node review server, prints the URL, and opens
  the spec with the review layer (live tracker + live reload) injected.
allowed-tools: Read, Bash, Glob
---

# serve-spec

Start the SpecForge review server and open a spec for browser review. The server
is zero-dependency Node — no install step.

`${CLAUDE_PLUGIN_ROOT}` is the installed plugin directory.

## 1. Resolve specs dir

- Default specs dir is `<project>/specs`; honor `<project>/.specforge/config.json`
  (`specsDir`, `port`) if present.

## 2. Find the running server (if any)

The server advertises its actual bound address at
`<specsDir>/.specforge/server.json` (`{ "port", "pid", "url" }`). **Always read
the bound port from this file — it may differ from the configured port after a
collision fallback.**

- If `server.json` exists, health-check its port:
  `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<bound-port>/healthz`.
- If that returns `200`, the server is already up — reuse it (skip to step 4).

## 3. Start the server (only if not already running)

```
node "${CLAUDE_PLUGIN_ROOT}/server/start.mjs" --project "<project-root>" &
```

Give it ~1s, then read `<specsDir>/.specforge/server.json` for the bound port and
health-check it. Do **not** loop spawning more servers — read the state file to
learn the real port.

## 4. Open the spec

- If the user named a spec file, get its URL (this reads `server.json` for you,
  so the port is always correct):

  ```
  node "${CLAUDE_PLUGIN_ROOT}/server/start.mjs" --project "<project-root>" --resolve "<spec-file>"
  ```

  Otherwise use the index URL `http://127.0.0.1:<bound-port>/`.
- Open it in the browser (`xdg-open` / `open` / `start`), or print the URL for the
  user to click.

## 5. Report

- Print the server URL and the spec URL. Mention that edits to the spec file
  live-reload the page, and the task tracker renders live from the plan.

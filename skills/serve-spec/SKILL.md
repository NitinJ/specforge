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

## 1. Resolve specs dir + port

- Default specs dir is `<project>/specs`; honor `<project>/.specforge/config.json`
  (`specsDir`, `port`) if present. Default port is `4178`.

## 2. Ensure the server is running (idempotent)

- Check health: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/healthz`.
- If it does **not** return `200`, start the server in the background:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/server/start.mjs" --project "<project-root>" &
  ```

  It prints the bound URL (it falls back to the next port if `<port>` is taken —
  use the printed port). Give it ~1s, then re-check health.

## 3. Open the spec

- If the user named a spec file, get its URL:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/server/start.mjs" --project "<project-root>" --resolve "<spec-file>"
  ```

  Otherwise use the index URL `http://127.0.0.1:<port>/`.
- Open it in the browser (`xdg-open` / `open` / `start`), or just print the URL
  for the user to click.

## 4. Report

- Print the server URL and the spec URL. Mention that edits to the spec file
  live-reload the page, and the task tracker renders live from the plan.

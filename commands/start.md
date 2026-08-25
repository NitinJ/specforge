---
description: Start the SpecForge review server and print the index URL
---

Start (or reuse) the SpecForge daemon and give the user the browser index URL.

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/specforge-cli.mjs" start` — it ensures the
daemon is up and prints `{ "url": "http://127.0.0.1:<port>/" }`. Report that
`url` as a clickable link the user can open; the index lists every spec and links
each to `/spec/<id>`. Don't open the browser unless asked.

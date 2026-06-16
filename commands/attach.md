---
description: Attach live review to an existing spec — serve it and go on-shift
---

Attach SpecForge **live review** to an existing spec: ensure the review server is
running, open the spec, then go **on-shift** so comments submitted in the browser
reach you immediately (no turn-boundary wait).

Do this in order:

1. Invoke `specforge:serve-spec` for the spec below to start (or focus) the
   server and resolve its review URL + `specId`. Give the human the URL.
2. Then run the `specforge:review-spec` skill in **live mode** (its on-shift
   loop): long-poll `comment-cli await <specsDir> <specId>`, process each
   delivered batch (reply inline + amend the spec + mark it done), and re-await.
   Stop after ~4 consecutive idle cycles (≈100s of silence) or when the human
   says to detach.

The spec must already exist (use `/specforge:create` for a new one). Spec path
or name:

$ARGUMENTS

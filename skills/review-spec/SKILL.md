---
name: specforge:review-spec
description: |
  Process a submitted batch of human comments on a spec: reply to each thread
  inline and amend the spec accordingly. Usually auto-invoked by the Stop hook
  when a comment batch is submitted in the browser; can also be run manually.
  Replies are append-only; only the human resolves threads.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# review-spec

Read a submitted comment batch, reply inline to each thread, and amend the spec
file per the comments.

> **Status:** stub — implemented in Stage 4 (review loop), alongside the Stop-hook
> auto-inject and the comments engine from Stage 3.

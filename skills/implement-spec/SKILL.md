---
name: specforge:implement-spec
description: |
  Drive implementation of an approved spec stage by stage, keeping the spec the
  canonical source of truth. Use when the user asks to "implement", "build", or
  "start building" a spec. Sets the active-spec marker, works the plan with TDD,
  keeps the task tracker + impl-time sections (design decisions / deviations /
  tradeoffs) current, and honors one-PR-per-stage cadence. Blocked by the
  pre-implementation gate until the spec is ready.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# implement-spec

Implement an approved spec, with the SpecForge hooks enforcing tracker/decision
currency and the stage→task→PR cadence.

> **Status:** stub — implemented in Stage 6 (enforcement), which also adds the
> pre-implementation gate and the evidence-ledger/drift hooks.

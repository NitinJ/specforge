---
name: specforge:create-spec
description: |
  Author a new house-style design spec as a self-contained .html file. Use when
  the user asks to "write a spec", "create a design doc", "draft a spec for
  <feature/bug>", or "start a spec". Produces a light/dark-capable HTML spec with
  the required sections, stable section IDs, a structured Stages & Tasks plan, a
  live task tracker, and impl-time stubs (design decisions / deviations /
  tradeoffs). Enforces project house rules from .specforge/config.json.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# create-spec

Generate a new SpecForge spec from the canonical template, honoring the project's
house rules (required sections, naming, theme, specs dir).

> **Status:** stub — full authoring behavior is implemented in Stage 1.
> See `templates/spec-base.html` and `templates/house-rules.md` (added in Stage 1).

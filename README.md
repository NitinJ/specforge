# SpecForge

A Claude Code plugin for **spec authoring, review & agent collaboration**.

SpecForge owns the full lifecycle of a design spec:

1. **Author** — skills generate house-style `.html` specs (light/dark, strong presentation, a structured Stages & Tasks plan, a live task tracker, and dedicated impl-time sections for design decisions / deviations / tradeoffs).
2. **Review & collaborate** — a bundled Node server renders any spec in the browser with a Google-Docs-style comment layer (sidebar + floating markers + highlights). A human leaves comments anchored to sections/quotes; submitting a batch gets Claude to reply inline **and** amend the spec.
3. **Enforce** — hooks keep the spec and the implementation in lockstep: the task tracker, decisions, deviations & tradeoffs stay current, and the spec's stage→task→PR cadence is enforced.

> Status: **in development**. See the design spec at `~/workspace/specs/specforge/2026-06-02-specforge-plugin-design.html`.

## Install

_(coming soon — local plugin install via `claude plugin`)_

## License

MIT © Nitin Jaglan

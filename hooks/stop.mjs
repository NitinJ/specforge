#!/usr/bin/env node
// SpecForge — Stop hook.
//
// Workhorse hook. In later stages it (a) drains the review inbox to auto-inject
// comment-review work, and (b) enforces the implementation pattern (tracker /
// PR / decisions drift) when a spec is being implemented.
//
// Stage 0: fail-safe no-op.
import { noop } from './lib/io.mjs';

await noop();

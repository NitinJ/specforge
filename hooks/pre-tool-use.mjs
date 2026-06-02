#!/usr/bin/env node
// SpecForge — PreToolUse hook.
//
// In later stages: a backstop that blocks code edits when the pre-implementation
// gate is unmet, or warns on edits to a spec marked `closed`.
//
// Stage 0: fail-safe no-op.
import { noop } from './lib/io.mjs';

await noop();

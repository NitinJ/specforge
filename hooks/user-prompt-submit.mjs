#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook.
//
// In later stages: a fallback drain that surfaces pending review batches on the
// next human turn when no live session picked them up.
//
// Stage 0: fail-safe no-op.
import { noop } from './lib/io.mjs';

await noop();

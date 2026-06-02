#!/usr/bin/env node
// SpecForge — PostToolUse hook.
//
// In later stages: appends to the per-spec "evidence ledger" (commits, PR ops,
// test runs, edits) so the Stop hook can detect spec/implementation drift.
//
// Stage 0: fail-safe no-op.
import { noop } from './lib/io.mjs';

await noop();

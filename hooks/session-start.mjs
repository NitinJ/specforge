#!/usr/bin/env node
// SpecForge — SessionStart hook.
//
// In later stages: drains a review inbox left behind by comments submitted while
// no session was running, surfacing pending batches at session start.
//
// Stage 0: fail-safe no-op.
import { noop } from './lib/io.mjs';

await noop();

#!/usr/bin/env node
// SpecForge — Stop hook.
//
// Claude Code's name for "the agent intends to stop". Translation only: the
// decision is lib/harness/policy.mjs, which names no harness, and everything
// Claude Code-specific about expressing it is in hooks/lib/emit.mjs.
//
// What it can decide: a pending review batch, a queued export or template
// generation, or a session about to settle owning specs nobody is watching.
// Each of those refuses the settle, because settling in that state is the bug.

import { run as runHook, main } from './lib/emit.mjs';

export const run = (input = {}, env = process.env) => runHook('turn_settled', 'Stop', input, env);

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main('turn_settled', 'Stop');

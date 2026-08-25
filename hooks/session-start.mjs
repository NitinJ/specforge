#!/usr/bin/env node
// SpecForge — SessionStart hook.
//
// Claude Code's name for "a conversation began or resumed". Translation only:
// the decision is lib/harness/policy.mjs.
//
// A fresh session owns nothing, so this is a no-op for almost every session. A
// RESUMED one already owning specs is the case that matters: the in-session
// review watcher died with the previous run and nothing re-arms it, so browser
// comments would be picked up only on the next manual turn, never while idle.

import { run as runHook, main } from './lib/emit.mjs';

export const run = (input = {}, env = process.env) =>
  runHook('session_start', 'SessionStart', input, env);

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main('session_start', 'SessionStart');

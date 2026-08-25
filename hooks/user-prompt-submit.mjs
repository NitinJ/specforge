#!/usr/bin/env node
// SpecForge — UserPromptSubmit hook.
//
// Claude Code's name for "the agent is about to act on user input". Translation
// only: the decision is lib/harness/policy.mjs.
//
// It surfaces the same queued work the Stop hook does, but never refuses
// anything. A turn the user just started is theirs to spend.

import { run as runHook, main } from './lib/emit.mjs';
import { isMain } from '../lib/is-main.mjs';

export const run = (input = {}, env = process.env) =>
  runHook('turn_start', 'UserPromptSubmit', input, env);

const runningDirectly = isMain(import.meta.url);
if (runningDirectly) main('turn_start', 'UserPromptSubmit');

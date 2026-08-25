#!/usr/bin/env node
// I7 as a gate: nothing outside lib/harness/ and the two bindings may name one
// agent CLI's private vocabulary.
//
//   node scripts/check-harness-coupling.mjs        # exit 1 on any hit
//
// This is not a survey of the word "claude". That word appears legitimately all
// over: `LEGACY_HARNESS = 'claude'` is the whole of the pre-migration read path,
// the Claude adapter is named after it, and the README installs into it. What
// this checks is narrower and is what E1 actually rests on: a file that reads one
// CLI's environment, renders one CLI's skill id, or speaks one CLI's hook
// protocol is a file a second CLI cannot use.
//
// Adding a harness must not require editing anything this scan covers.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that are allowed to name a CLI, because naming one is their job. */
const BINDINGS = ['lib/harness', 'hooks', 'extensions'];

/**
 * Surfaces that describe SpecForge to people rather than running it.
 *
 * A README that could not say "Claude Code" could not tell anyone how to install
 * it. What matters is that no code path depends on the name.
 */
const PROSE = [
  'README.md', 'AGENTS.md', 'LICENSE', 'install.sh',
  'docs', 'specs', '.claude-plugin', '.claude', '.github',
  'package.json', 'package-lock.json',
];

/** Never walked: generated bundles, dependencies, and the suite's own fixtures. */
const SKIP = new Set(['node_modules', '.git', '.specforge', 'test', 'test-e2e', '--help']);

const PATTERNS = [
  // Reading one CLI's environment. `currentHarness()` is the answer.
  ['claude env var', /\bCLAUDE_[A-Z_]+\b/g],
  ['pi env var', /\bPI_[A-Z_]+\b/g],
  // Rendering one CLI's address for a skill. `harness.workRef(id)` is the answer.
  // Anchored on the skills that exist, so `specforge:components` (a CSS marker)
  // is not mistaken for one.
  ['claude skill id', /specforge:(create|convert|export|export-md|list|listall|start|review-spec|create-spec|convert-spec|generate-template|list-specs|migrate-spec|tune-templates)\b/g],
  ['pi skill id', /\/skill:[a-z-]+/g],
  // Speaking one CLI's protocol. A Notice is the answer.
  ['claude hook event', /\b(SessionStart|UserPromptSubmit|SubagentStop|PreCompact|PreToolUse|PostToolUse)\b/g],
  ['claude hook output', /hookSpecificOutput|stop_hook_active/g],
  ['claude block decision', /decision['"]?\s*:\s*['"]block/g],
  // Pi's own event names, for the same reason in the other direction.
  ['pi event', /\b(before_agent_start|agent_settled|agent_end)\b/g],
];

/** This file, which has to hold the patterns in order to look for them. */
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

const allowed = (rel) => {
  const head = rel.split(sep)[0];
  return rel === SELF
    || BINDINGS.some((b) => rel === b || rel.startsWith(b + sep))
    || PROSE.includes(rel) || PROSE.includes(head);
};

const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(mjs|js|json|md|html|css|sh)$/.test(name)) continue;
    const rel = relative(ROOT, p);
    if (allowed(rel)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [label, re] of PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line)) hits.push({ rel, line: i + 1, label, text: line.trim().slice(0, 120) });
      }
    });
  }
}

walk(ROOT);

if (!hits.length) {
  console.log('harness coupling: 0 hits outside lib/harness/, hooks/ and extensions/');
  process.exit(0);
}

console.error(`harness coupling: ${hits.length} hit(s)\n`);
for (const h of hits) console.error(`  ${h.rel}:${h.line}  [${h.label}]  ${h.text}`);
console.error('\nEach of these makes SpecForge need one particular CLI. See docs/adding-a-harness.md.');
process.exit(1);

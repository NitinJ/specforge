#!/usr/bin/env node
// Implementation operations for the implement-spec skill. Keeps the spec the
// canonical source of truth via deterministic edits (rather than hand-editing
// HTML).
//
//   gate   <specsDir> <specId>                     — run the pre-implementation gate (exit 1 if it fails)
//   start  <specsDir> <specId> [--stage N --task T] — gate, then mark active + status=implementing
//   task   <specsDir> <specId> <taskId> <status>    — set a task's status (+ refresh tracker)
//   pr     <specsDir> <specId> <stage> <pr>         — record a stage's PR
//   status <specsDir> <specId> <status>             — set the document status
//   finish <specsDir> <specId>                      — status=done + clear the active marker

import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { resolveSpec } from './paths.mjs';
import { checkGate } from './gate.mjs';
import { setActive, clearActive } from './active.mjs';
import { setTaskStatus, setStagePr, setSpecStatus } from './plan-edit.mjs';
import { writeTrackerSnapshot } from './tracker.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function specFile(specsDir, specId) {
  const spec = resolveSpec(specsDir, specId);
  if (!spec) fail(`spec not found: ${specId}`);
  return spec;
}

function flag(rest, name) {
  const i = rest.indexOf(name);
  return i !== -1 ? rest[i + 1] : undefined;
}

const [cmd, specsDir, specId, a, b, ...rest] = process.argv.slice(2);
if (!cmd || !specsDir || !specId) fail('usage: impl-cli.mjs <gate|start|task|pr|status|finish> <specsDir> <specId> …');

const spec = specFile(specsDir, specId);
const read = () => readFileSync(spec.file, 'utf8');
const write = (html) => writeFileSync(spec.file, html);

if (cmd === 'gate' || cmd === 'start') {
  const config = loadConfig(process.cwd());
  const { ok, checks } = checkGate(read(), config);
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);
  if (!ok) {
    console.error('\ngate: FAIL — resolve the above before implementing');
    process.exit(1);
  }
  console.log('\ngate: PASS');
  if (cmd === 'start') {
    const allRest = [a, b, ...rest].filter((x) => x !== undefined);
    setActive(specsDir, {
      specId, specPath: spec.relPath, stage: flag(allRest, '--stage'), task: flag(allRest, '--task'),
    });
    write(setSpecStatus(read(), 'implementing'));
    console.log('active marker set; status → implementing');
  }
} else if (cmd === 'task') {
  if (!a || !b) fail('usage: task <specsDir> <specId> <taskId> <status>');
  write(setTaskStatus(read(), a, b));
  writeTrackerSnapshot(spec.file);
  console.log(`task ${a} → ${b}`);
} else if (cmd === 'pr') {
  if (!a || !b) fail('usage: pr <specsDir> <specId> <stage> <pr>');
  write(setStagePr(read(), a, b));
  writeTrackerSnapshot(spec.file);
  console.log(`stage ${a} → PR ${b}`);
} else if (cmd === 'status') {
  if (!a) fail('usage: status <specsDir> <specId> <status>');
  write(setSpecStatus(read(), a));
  console.log(`status → ${a}`);
} else if (cmd === 'finish') {
  write(setSpecStatus(read(), 'done'));
  clearActive(specsDir);
  console.log('status → done; active marker cleared');
} else {
  fail(`unknown command: ${cmd}`);
}

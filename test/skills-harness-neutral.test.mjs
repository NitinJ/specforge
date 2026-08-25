// The skills, checked for anything only one agent CLI understands.
//
// A SKILL.md is instructions the model follows literally, so a path only Claude
// Code expands is not a cosmetic problem: on any other harness the agent runs a
// command with an empty string in it. These assertions are what stop that
// creeping back in one file at a time.
//
// Spec e9ddcddef6, stage 4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const COMMANDS = join(ROOT, 'commands');

/** Every SKILL.md, as `{ name, text, frontmatter }`. */
function skills() {
  return readdirSync(SKILLS)
    .filter((d) => existsSync(join(SKILLS, d, 'SKILL.md')))
    .map((name) => {
      const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
      return { name, text, fm: (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '' };
    });
}

const field = (fm, key) => (fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim() ?? null;

// --- self location ----------------------------------------------------------

test('no skill names the plugin root variable', () => {
  // Claude Code expands it at load; Pi expands nothing, so the agent would run
  // `node "/lib/specforge-cli.mjs"`.
  for (const s of skills()) {
    assert.doesNotMatch(s.text, /CLAUDE_PLUGIN_ROOT/, s.name);
  }
});

test('no prompt template names it either', () => {
  for (const name of readdirSync(COMMANDS).filter((f) => f.endsWith('.md'))) {
    assert.doesNotMatch(readFileSync(join(COMMANDS, name), 'utf8'), /CLAUDE_PLUGIN_ROOT/, name);
  }
});

test('no skill builds a path with a command substitution', () => {
  // `$(specforge root)/references/x.md` runs on every CLI and is still wrong
  // here: Claude Code matches a Bash command against an allowlist as a literal
  // string, so a substitution stops the turn for a manual approval every time.
  for (const s of skills()) {
    const hits = (s.text.match(/\$\(specforge[^)]*\)/g) || []);
    assert.deepEqual(hits, [], `${s.name}: ${hits.join(', ')}`);
  }
});

test('the CLI is called by name, not by path', () => {
  const someone = skills().filter((s) => /\bspecforge \w/.test(s.text));
  assert.ok(someone.length >= 5, `only ${someone.length} skills call the CLI by name`);
  for (const s of skills()) {
    assert.doesNotMatch(s.text, /node "[^"]*lib\/specforge-cli\.mjs"/, s.name);
  }
});

// --- frontmatter, for both CLIs ---------------------------------------------

test('every skill name is legal in both CLIs', () => {
  // Pi: 1-64 chars, lowercase letters, digits and hyphens, no leading, trailing
  // or doubled hyphen. Claude Code takes the plugin prefix from the directory,
  // so a colon here would land in the last segment of the command.
  for (const s of skills()) {
    const name = field(s.fm, 'name');
    assert.ok(name, `${s.name} declares a name`);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${s.name}: "${name}"`);
    assert.ok(name.length <= 64, `${s.name}: name is ${name.length} chars`);
  }
});

test('a skill name matches its directory, so the command is predictable', () => {
  for (const s of skills()) {
    assert.equal(field(s.fm, 'name'), s.name, s.name);
  }
});

test('allowed-tools is space-delimited, which both CLIs accept', () => {
  // Claude Code takes "a space- or comma-separated string, or a YAML list"; Pi
  // documents space-delimited only.
  for (const s of skills()) {
    const tools = field(s.fm, 'allowed-tools');
    if (!tools) continue;
    assert.doesNotMatch(tools, /,/, `${s.name}: ${tools}`);
  }
});

test('every skill has a description, which Pi requires', () => {
  for (const s of skills()) {
    assert.match(s.fm, /^description:/m, s.name);
  }
});

// --- Q8: preconditions in the body ------------------------------------------

test('a skill hidden from one CLI\'s users checks its own preconditions', () => {
  // `user-invocable: false` is a Claude Code field and Pi has no equivalent, so
  // a Pi user can type any of these. Each says what it needs and stops.
  const hidden = skills().filter((s) => field(s.fm, 'user-invocable') === 'false');
  assert.ok(hidden.length >= 4, `expected several hidden skills, got ${hidden.length}`);
  for (const s of hidden) {
    assert.match(s.text, /Before anything else, check|This skill is for an agent/, s.name);
  }
});

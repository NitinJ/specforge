import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('plugin.json is valid and well-formed', () => {
  const p = readJSON('.claude-plugin/plugin.json');
  assert.equal(p.name, 'specforge');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.ok(p.description && p.description.length > 10);
  assert.ok(p.author && p.author.name);
  assert.equal(p.license, 'MIT');
  assert.ok(existsSync(join(ROOT, p.skills)), 'skills dir exists');
  assert.ok(existsSync(join(ROOT, p.commands)), 'commands dir exists');
});

test('marketplace.json is valid and matches plugin', () => {
  const m = readJSON('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'specforge');
  assert.ok(Array.isArray(m.plugins) && m.plugins.length >= 1);
  assert.equal(m.plugins[0].name, 'specforge');
  assert.equal(m.plugins[0].source, './');
});

test('package.json is an ES module with a test script', () => {
  const pkg = readJSON('package.json');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.scripts && pkg.scripts.test, 'has test script');
});

test('hooks.json declares the expected events and references existing scripts', () => {
  const h = readJSON('hooks/hooks.json');
  const expected = ['Stop', 'PostToolUse', 'PreToolUse', 'SessionStart', 'UserPromptSubmit'];
  for (const ev of expected) {
    assert.ok(Array.isArray(h.hooks[ev]), `event ${ev} declared`);
    for (const group of h.hooks[ev]) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, 'command');
        const m = hook.command.match(/hooks\/([\w.-]+\.mjs)/);
        assert.ok(m, `command references a hook script: ${hook.command}`);
        assert.ok(existsSync(join(ROOT, 'hooks', m[1])), `hook script exists: ${m[1]}`);
      }
    }
  }
});

test('every skill has a SKILL.md with name + description frontmatter', () => {
  const skillsDir = join(ROOT, 'skills');
  const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.ok(skills.length >= 4, 'at least 4 skills');
  for (const s of skills) {
    const md = readText(join('skills', s.name, 'SKILL.md'));
    assert.match(md, /^---/, `${s.name}/SKILL.md has frontmatter`);
    assert.match(md, /\nname:\s*specforge:/, `${s.name}/SKILL.md declares a name`);
    assert.match(md, /\ndescription:/, `${s.name}/SKILL.md declares a description`);
  }
});

test('every command file has a description frontmatter', () => {
  const cmds = readdirSync(join(ROOT, 'commands')).filter((f) => f.endsWith('.md'));
  assert.ok(cmds.length >= 4, 'at least 4 commands');
  for (const c of cmds) {
    const md = readText(join('commands', c));
    assert.match(md, /^---/, `${c} has frontmatter`);
    assert.match(md, /\ndescription:/, `${c} declares a description`);
  }
});

test('each hook runs as a fail-safe no-op (exit 0, no output)', () => {
  const hooks = ['stop', 'post-tool-use', 'pre-tool-use', 'session-start', 'user-prompt-submit'];
  for (const name of hooks) {
    const res = spawnSync(process.execPath, [join(ROOT, 'hooks', `${name}.mjs`)], {
      input: JSON.stringify({ hook_event_name: 'Test', cwd: ROOT }),
      encoding: 'utf8',
      timeout: 8000,
    });
    assert.ifError(res.error); // distinguishes a failed/timed-out spawn from a non-zero exit
    assert.equal(res.status, 0, `${name}.mjs exits 0 (stderr: ${res.stderr})`);
    assert.equal((res.stdout || '').trim(), '', `${name}.mjs produces no stdout`);
  }
});

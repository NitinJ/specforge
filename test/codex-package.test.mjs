import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('Codex manifest describes the same package and canonical skills', () => {
  const pkg = json(join(ROOT, 'package.json'));
  const claude = json(join(ROOT, '.claude-plugin', 'plugin.json'));
  const codex = json(join(ROOT, '.codex-plugin', 'plugin.json'));
  assert.equal(codex.name, pkg.name);
  assert.equal(codex.version, pkg.version);
  assert.equal(codex.version, claude.version);
  assert.equal(codex.skills, './skills/');
  assert.equal(codex.hooks, undefined, 'Codex discovers hooks/hooks.json by convention');
  assert.equal(codex.interface.displayName, 'SpecForge');
});

test('package validator accepts the source tree', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'validate-package.mjs'), ROOT], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('release builder copies one unchanged runtime tree into a path with spaces', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sf codex package '));
  const marketplace = join(temp, 'market place');
  try {
    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'build-codex-marketplace.mjs'), ROOT, marketplace,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const installed = join(marketplace, 'plugins', 'specforge');
    assert.equal(
      readFileSync(join(installed, 'skills', 'review-spec', 'SKILL.md'), 'utf8'),
      readFileSync(join(ROOT, 'skills', 'review-spec', 'SKILL.md'), 'utf8'),
    );
    assert.equal(
      readFileSync(join(installed, 'lib', 'store-drain.mjs'), 'utf8'),
      readFileSync(join(ROOT, 'lib', 'store-drain.mjs'), 'utf8'),
    );
    assert.ok(json(join(marketplace, '.agents', 'plugins', 'marketplace.json')));
    assert.doesNotMatch(installed, /node_modules/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI entry executes from an installed path containing spaces', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sf codex cli '));
  const marketplace = join(temp, 'market place');
  try {
    const built = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'build-codex-marketplace.mjs'), ROOT, marketplace,
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const cli = join(marketplace, 'plugins', 'specforge', 'lib', 'specforge-cli.mjs');
    const result = spawnSync(process.execPath, [cli, 'actions'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).actions.length > 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

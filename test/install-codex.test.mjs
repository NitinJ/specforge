import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sf-install-codex-'));
  const bin = join(root, 'bin');
  const log = join(root, 'codex.log');
  const setup = spawnSync('mkdir', ['-p', bin]);
  assert.equal(setup.status, 0);
  const stub = join(bin, 'codex');
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`);
  chmodSync(stub, 0o755);
  return { root, log, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` } };
}

test('Codex-only install does not require Claude and registers the built marketplace', () => {
  const f = fixture();
  const installRoot = join(f.root, 'installed market');
  try {
    const result = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(installRoot, 'plugins', 'specforge', '.codex-plugin', 'plugin.json')));
    const calls = readFileSync(f.log, 'utf8');
    assert.match(calls, new RegExp(`plugin marketplace add ${installRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(calls, /plugin add specforge@specforge/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Codex dry-run and removal preserve the shared SpecForge store', () => {
  const f = fixture();
  const installRoot = join(f.root, 'installed');
  const store = join(f.root, 'store');
  const sentinel = join(store, 'keep.txt');
  spawnSync('mkdir', ['-p', store]);
  writeFileSync(sentinel, 'keep');
  try {
    const dry = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot, '--dry-run'], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.equal(dry.status, 0, dry.stderr || dry.stdout);
    assert.equal(existsSync(installRoot), false);

    const install = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const remove = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--remove', '--install-root', installRoot], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.equal(remove.status, 0, remove.stderr || remove.stdout);
    assert.equal(existsSync(installRoot), false);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
    assert.match(readFileSync(f.log, 'utf8'), /plugin remove specforge@specforge/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Codex repeat install updates through plugin add and retains rollback', () => {
  const f = fixture();
  const installRoot = join(f.root, 'installed');
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot], {
        cwd: ROOT, env: f.env, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const calls = readFileSync(f.log, 'utf8');
    assert.equal(calls.match(/plugin add specforge@specforge/g)?.length, 2);
    assert.ok(existsSync(`${installRoot}.previous`));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a rejected Codex update restores the previous validated marketplace', () => {
  const f = fixture();
  const installRoot = join(f.root, 'installed');
  try {
    const first = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const stub = join(f.root, 'bin', 'codex');
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(f.log)}\ncase "$*" in\n  "plugin add"*) exit 9 ;;\nesac\n`);
    chmodSync(stub, 0o755);
    const update = spawnSync('bash', [join(ROOT, 'install.sh'), '--harness', 'codex', '--plugin-only', '--install-root', installRoot], {
      cwd: ROOT, env: f.env, encoding: 'utf8',
    });
    assert.notEqual(update.status, 0);
    assert.match(update.stderr, /restored the previous/i);
    assert.ok(existsSync(join(installRoot, '.specforge-owned')));
    assert.equal(existsSync(`${installRoot}.previous`), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

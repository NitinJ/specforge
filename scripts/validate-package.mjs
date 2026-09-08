#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'hooks/hooks.json',
  'hooks/session-start.mjs',
  'hooks/session-end.mjs',
  'hooks/user-prompt-submit.mjs',
  'hooks/stop.mjs',
  'lib/specforge-cli.mjs',
  'server/daemon.mjs',
  'skills/review-spec/SKILL.md',
  'package.json',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function filesUnder(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function validatePackage(root) {
  const packageRoot = resolve(root);
  const errors = [];
  for (const file of REQUIRED) {
    if (!existsSync(join(packageRoot, file))) errors.push(`missing runtime file: ${file}`);
  }
  if (errors.length) return errors;

  const pkg = readJson(join(packageRoot, 'package.json'));
  const claude = readJson(join(packageRoot, '.claude-plugin', 'plugin.json'));
  const codex = readJson(join(packageRoot, '.codex-plugin', 'plugin.json'));
  const codexBaseVersion = String(codex.version || '').split('+codex.')[0];
  if (pkg.name !== claude.name || pkg.name !== codex.name) errors.push('host manifest names must match package.json');
  if (pkg.version !== claude.version || pkg.version !== codexBaseVersion) errors.push('host manifest versions must match package.json');
  if (codex.skills !== './skills/') errors.push('Codex manifest must use the shared skills directory');
  if ('hooks' in codex) errors.push('Codex manifest must use default hooks/hooks.json discovery');

  for (const skill of readdirSync(join(packageRoot, 'skills'), { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const path = join(packageRoot, 'skills', skill.name, 'SKILL.md');
    if (!existsSync(path)) errors.push(`skill has no SKILL.md: ${skill.name}`);
  }

  const codeRoots = ['components', 'hooks', 'lib', 'pi', 'server'];
  for (const path of codeRoots.flatMap((name) => filesUnder(join(packageRoot, name)))) {
    if (!/\.(?:mjs|js|ts)$/.test(path)) continue;
    const source = readFileSync(path, 'utf8');
    const imports = source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g);
    for (const match of imports) {
      const target = resolve(dirname(path), match[1]);
      if (!existsSync(target) || !statSync(target).isFile()) {
        errors.push(`missing relative import from ${path.slice(packageRoot.length + 1)}: ${match[1]}`);
      }
    }
  }
  return errors;
}

function main() {
  const root = process.argv[2];
  if (!root) throw new Error('usage: validate-package.mjs <plugin-root>');
  const errors = validatePackage(root);
  if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`valid SpecForge package: ${resolve(root)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

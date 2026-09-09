#!/usr/bin/env node

import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePackage } from './validate-package.mjs';
import { assertOwnedMarketplace, OWNERSHIP_MARKER } from './codex-marketplace-ownership.mjs';

const CONTENT = [
  '.claude-plugin', '.codex-plugin', 'commands', 'components', 'hooks', 'lib',
  'pi', 'references', 'server', 'skills', 'templates', 'LICENSE', 'README.md',
  'package.json',
];

function contentVersion(source) {
  const hash = createHash('sha256');
  for (const name of CONTENT) hash.update(name).update(readFileOrNames(join(source, name)));
  return hash.digest('hex').slice(0, 12);
}

function readFileOrNames(path) {
  if (!statSync(path).isDirectory()) return readFileSync(path);
  return Buffer.concat(readdirSync(path).sort().flatMap((name) => [
    Buffer.from(name), readFileOrNames(join(path, name)),
  ]));
}

export function buildCodexMarketplace(sourceArg, destinationArg) {
  const source = resolve(sourceArg);
  const destination = resolve(destinationArg);
  const staging = `${destination}.next`;
  const previous = `${destination}.previous`;
  const plugin = join(staging, 'plugins', 'specforge');

  for (const path of [destination, staging, previous]) assertOwnedMarketplace(path);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(staging, '.specforge-owned'), OWNERSHIP_MARKER);
  for (const name of CONTENT) cpSync(join(source, name), join(plugin, name), { recursive: true });

  const manifestPath = join(plugin, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = `${String(manifest.version).split('+')[0]}+codex.${contentVersion(source)}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const marketplace = {
    name: 'specforge',
    interface: { displayName: 'SpecForge' },
    plugins: [{
      name: 'specforge',
      source: { source: 'local', path: './plugins/specforge' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    }],
  };
  mkdirSync(join(staging, '.agents', 'plugins'), { recursive: true });
  writeFileSync(join(staging, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);

  const errors = validatePackage(plugin);
  if (errors.length) throw new Error(errors.join('\n'));
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(destination)) renameSync(destination, previous);
  renameSync(staging, destination);
  return {
    destination,
    plugin: join(destination, 'plugins', 'specforge'),
    previous: existsSync(previous) ? previous : null,
  };
}

function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error('usage: build-codex-marketplace.mjs <source> <destination>');
  const result = buildCodexMarketplace(process.argv[2], process.argv[3]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

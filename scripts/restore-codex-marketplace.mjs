#!/usr/bin/env node

import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: restore-codex-marketplace.mjs <destination>');
if (!existsSync(join(root, '.specforge-owned'))) {
  throw new Error(`refusing to replace an unowned directory: ${root}`);
}

const previous = `${root}.previous`;
if (!existsSync(previous)) {
  rmSync(root, { recursive: true, force: true });
  process.stdout.write('removed rejected first install\n');
} else {
  const rejected = `${root}.rejected`;
  rmSync(rejected, { recursive: true, force: true });
  renameSync(root, rejected);
  renameSync(previous, root);
  rmSync(rejected, { recursive: true, force: true });
  process.stdout.write('restored previous SpecForge marketplace\n');
}

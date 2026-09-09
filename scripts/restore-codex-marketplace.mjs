#!/usr/bin/env node

import { renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertOwnedMarketplace } from './codex-marketplace-ownership.mjs';

const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: restore-codex-marketplace.mjs <destination>');
if (!assertOwnedMarketplace(root)) {
  throw new Error(`refusing to replace an unowned directory: ${root}`);
}

const previous = `${root}.previous`;
const rejected = `${root}.rejected`;
const hasPrevious = assertOwnedMarketplace(previous);
assertOwnedMarketplace(rejected);
if (!hasPrevious) {
  rmSync(root, { recursive: true, force: true });
  process.stdout.write('removed rejected first install\n');
} else {
  rmSync(rejected, { recursive: true, force: true });
  renameSync(root, rejected);
  renameSync(previous, root);
  rmSync(rejected, { recursive: true, force: true });
  process.stdout.write('restored previous SpecForge marketplace\n');
}

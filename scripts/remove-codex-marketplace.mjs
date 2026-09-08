#!/usr/bin/env node

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: remove-codex-marketplace.mjs <destination>');
if (existsSync(root) && !existsSync(join(root, '.specforge-owned'))) {
  throw new Error(`refusing to remove an unowned directory: ${root}`);
}
rmSync(root, { recursive: true, force: true });
rmSync(`${root}.previous`, { recursive: true, force: true });

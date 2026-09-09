#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertOwnedMarketplace } from './codex-marketplace-ownership.mjs';

const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: remove-codex-marketplace.mjs <destination>');
assertOwnedMarketplace(root);
assertOwnedMarketplace(`${root}.previous`);
rmSync(root, { recursive: true, force: true });
rmSync(`${root}.previous`, { recursive: true, force: true });

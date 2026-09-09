import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OWNERSHIP_MARKER = 'SpecForge Codex marketplace\n';

// Return false for an absent path; reject existing paths we do not own.
export function assertOwnedMarketplace(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return false;
  const marker = join(path, '.specforge-owned');
  if (!stat.isDirectory()
      || !lstatSync(marker, { throwIfNoEntry: false })?.isFile()
      || readFileSync(marker, 'utf8') !== OWNERSHIP_MARKER) {
    throw new Error(`refusing to modify an unowned directory: ${path}`);
  }
  return true;
}

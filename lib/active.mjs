// The active-implementation marker. While a spec is being implemented it lives at
// <specsDir>/.specforge/active.json and gates the enforcement hooks (they no-op
// when it's absent, so the plugin never touches unrelated work).

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

function activePath(specsDir) {
  return join(specsDir, '.specforge', 'active.json');
}

/** @param {string} specsDir @param {{specId:string, specPath:string, stage?:string, task?:string}} active */
export function setActive(specsDir, active) {
  const p = activePath(specsDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(active, null, 2));
  return active;
}

export function getActive(specsDir) {
  try {
    return JSON.parse(readFileSync(activePath(specsDir), 'utf8'));
  } catch {
    return null;
  }
}

export function clearActive(specsDir) {
  try {
    rmSync(activePath(specsDir));
  } catch {
    /* already gone */
  }
}

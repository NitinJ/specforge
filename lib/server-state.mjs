// The running review server advertises its actual bound address here so the
// serve-spec skill and `--resolve` can find it deterministically (the bound port
// may differ from the configured port after collision fallback).
//
// Lives at <specsDir>/.specforge/server.json (gitignored runtime state).

import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

function statePath(specsDir) {
  return join(specsDir, '.specforge', 'server.json');
}

/** @param {string} specsDir @param {{port:number, pid:number, url:string}} state */
export function writeServerState(specsDir, state) {
  const p = statePath(specsDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

/** @returns {{port:number, pid:number, url:string}|null} */
export function readServerState(specsDir) {
  try {
    return JSON.parse(readFileSync(statePath(specsDir), 'utf8'));
  } catch {
    return null;
  }
}

export function clearServerState(specsDir) {
  try {
    rmSync(statePath(specsDir));
  } catch {
    /* already gone */
  }
}

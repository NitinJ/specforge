// Store-wide UI prefs — currently just the index (home) page's theme. Kept in the
// store (~/.specforge/ui.json), not localStorage, so it's origin/port-independent
// (the daemon's port can fall forward) and embeds into the index with no flash.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { storeRoot, globalUiPath } from './store-paths.mjs';

const THEMES = ['light', 'dark'];

/** Coerce raw global prefs to the known subset (drops anything else). */
export function sanitizeGlobalPrefs(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && THEMES.includes(raw.theme)) out.theme = raw.theme;
  return out;
}

/** Read store-wide prefs, or {} when none are stored / unreadable. */
export function readGlobalPrefs() {
  try {
    return sanitizeGlobalPrefs(JSON.parse(readFileSync(globalUiPath(), 'utf8')));
  } catch {
    return {};
  }
}

/** Merge a validated patch into the store-wide prefs and persist; returns merged. */
export function writeGlobalPrefs(patch) {
  const merged = { ...readGlobalPrefs(), ...sanitizeGlobalPrefs(patch) };
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(globalUiPath(), JSON.stringify(merged, null, 2));
  return merged;
}

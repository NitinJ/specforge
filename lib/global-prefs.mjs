// Store-wide UI prefs — the reading settings that apply to EVERY spec: theme and
// font. (The index/home page reads theme too; it only renders light vs dark, so a
// named variant like dracula degrades to light there while the spec pages show the
// full variant.) Kept in the store (~/.specforge/ui.json), not localStorage, so
// it's origin/port-independent (the daemon's port can fall forward) and embeds into
// the served page with no flash. Per-document prefs (width/filter/fit/toc) stay in
// store-prefs.mjs. THEMES + FONTS are the shared whitelists from there.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { storeRoot, globalUiPath } from './store-paths.mjs';
import { THEMES, FONTS } from './store-prefs.mjs';

/** Coerce raw store-wide prefs to the known subset (drops anything else). */
export function sanitizeGlobalPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (THEMES.includes(raw.theme)) out.theme = raw.theme;
  if (FONTS.includes(raw.font)) out.font = raw.font;
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

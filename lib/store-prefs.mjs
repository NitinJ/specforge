// Per-spec UI preferences for the v2 global store: theme · width · sidebar filter.
//
// Stored at ~/.specforge/specs/<id>/ui.json — kept in its OWN file (not meta.json)
// so a browser pref write never races the per-turn heartbeat writes the hooks make
// to meta.json. The store is the source of truth so prefs survive across browsers
// and, crucially, across daemon PORT changes (localStorage is scoped to origin =
// host:port, so a port fall-forward would orphan client-side prefs; this doesn't).
//
// Only known, validated keys are persisted — unknown keys and out-of-range values
// are dropped on write, so the file stays a small, trusted shape the client can
// apply blind.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { specDir, uiPath } from './store-paths.mjs';

const THEMES = ['light', 'dark'];
const FILTERS = ['open', 'resolved', 'all'];
const WIDTH_MIN = 820;
const WIDTH_MAX = 1760;

/** Coerce a raw prefs object to the known, in-range subset (drops everything else). */
export function sanitizePrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (THEMES.includes(raw.theme)) out.theme = raw.theme;
  if (FILTERS.includes(raw.filter)) out.filter = raw.filter;
  // Require an actual number — Number(null)/Number(false)/Number('') all coerce to
  // 0 (finite), which would silently clamp to WIDTH_MIN instead of being dropped.
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) {
    out.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(raw.width)));
  }
  return out;
}

/** Read a spec's UI prefs, or {} when none are stored / the file is unreadable. */
export function readPrefs(id) {
  try {
    return sanitizePrefs(JSON.parse(readFileSync(uiPath(id), 'utf8')));
  } catch {
    return {};
  }
}

/**
 * Merge a validated patch into a spec's stored prefs and persist the result.
 * Only known keys in `patch` are applied (others ignored); returns the merged prefs.
 */
export function writePrefs(id, patch) {
  const merged = { ...readPrefs(id), ...sanitizePrefs(patch) };
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(uiPath(id), JSON.stringify(merged, null, 2));
  return merged;
}

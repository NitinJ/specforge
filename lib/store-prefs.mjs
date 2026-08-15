// Per-spec UI preferences for the v2 global store: width · sidebar filter · view
// options (fit / TOC visibility). These are genuinely per-document.
//
// theme and font are NOT here — they are store-wide (one reading setting for every
// spec) and live in global-prefs.mjs. THEMES + FONTS are the shared whitelists,
// exported here (the canonical lists) and reused there.
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

// light/dark are the spec's own palettes; the rest are review-layer variants
// (lib palettes live in review.css, keyed on [data-theme="<id>"]). Exported +
// reused by global-prefs (theme is store-wide).
export const THEMES = [
  'light', 'dark',
  'dracula', 'nord', 'solarized-dark',
  'solarized-light', 'github-light', 'gruvbox-light',
];
const FILTERS = ['open', 'resolved', 'all'];
// 'default' = the spec's own font; the rest are named reader/blog fonts (stacks +
// on-demand Google Fonts loading live in review.js/review.css). Store-wide, so
// exported + reused by global-prefs.
export const FONTS = [
  'default',
  'inter', 'google-sans', 'work-sans',
  'eb-garamond', 'merriweather', 'lora',
  'jetbrains-mono', 'fira-code', 'ibm-plex-mono',
  'poppins', 'space-grotesk', 'fraunces',
];
// The monospace faces, which are a separate choice from the reading font: one
// says what code looks like, the other what prose looks like. Kept as a subset of
// FONTS rather than a list of its own, so a face cannot exist in one and not the
// other. A mono id remains valid under `font` because that is where a pref saved
// before the split lives; the client reads it as a code font.
export const MONO_FONTS = ['default', 'jetbrains-mono', 'fira-code', 'ibm-plex-mono'];
const WIDTH_MIN = 820;
const WIDTH_MAX = 1760;

/**
 * Coerce a raw per-spec prefs object to the known, in-range subset (drops
 * everything else — including theme/font, which are store-wide now).
 */
export function sanitizePrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (FILTERS.includes(raw.filter)) out.filter = raw.filter;
  // Require an actual number — Number(null)/Number(false)/Number('') all coerce to
  // 0 (finite), which would silently clamp to WIDTH_MIN instead of being dropped.
  if (typeof raw.width === 'number' && Number.isFinite(raw.width)) {
    out.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(raw.width)));
  }
  // View options: fit-to-width (bool) and the left-TOC visibility.
  if (typeof raw.fit === 'boolean') out.fit = raw.fit;
  if (raw.toc === 'shown' || raw.toc === 'hidden') out.toc = raw.toc;
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

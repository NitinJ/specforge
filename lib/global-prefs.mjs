// Store-wide UI prefs — the reading settings that apply to EVERY spec: theme and
// font. (The index/home page reads theme too; it only renders light vs dark, so a
// named variant like dracula degrades to light there while the spec pages show the
// full variant.) It also holds collectionOrder, the project list and which
// project is selected, which are the index page's alone — spec pages take theme
// and font by name, never the whole object, because a published spec is served
// the same review layer a local one is and how the author has organised their
// store is nobody's business but theirs.
// Kept in the store (~/.specforge/ui.json), not localStorage, so
// it's origin/port-independent (the daemon's port can fall forward) and embeds into
// the served page with no flash. Per-document prefs (width/filter/fit/toc) stay in
// store-prefs.mjs. THEMES + FONTS are the shared whitelists from there.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { storeRoot, globalUiPath } from './store-paths.mjs';
import { THEMES, FONTS, MONO_FONTS } from './store-prefs.mjs';

/** How many collection or project names the stored order will hold. */
const MAX_ORDER = 200;

/** How long a single name in one of those lists may be. */
const MAX_NAME = 60;

/**
 * The order the index lists collections in, as names.
 *
 * Collections are derived from spec meta and have no record of their own, so
 * there is nowhere on a collection to hang a rank — the order has to live beside
 * the other things the user arranged. A name that no longer matches any spec is
 * kept rather than pruned: it costs nothing, and it means moving the last spec
 * out of a collection and back does not lose its place.
 */
function sanitizeOrder(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    // Trimmed and capped to the same 60 characters the organize layer enforces,
    // so a name cannot enter the order in a form no spec can ever carry.
    const name = v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length === MAX_ORDER) break;
  }
  return out;
}

/**
 * Which project the index is showing, in three states.
 *
 * `null` is All projects (the landing view), `''` is the No-project
 * pseudo-project, and anything else is a project by name. The blank string has
 * to survive trimming as a blank string rather than collapsing to null: they are
 * different selections, and conflating them would send a click on "No project"
 * to "All projects".
 */
function sanitizeSelection(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** Coerce raw store-wide prefs to the known subset (drops anything else). */
export function sanitizeGlobalPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (THEMES.includes(raw.theme)) out.theme = raw.theme;
  if (FONTS.includes(raw.font)) out.font = raw.font;
  if (MONO_FONTS.includes(raw.mono)) out.mono = raw.mono;
  const order = sanitizeOrder(raw.collectionOrder);
  if (order) out.collectionOrder = order;
  const projects = sanitizeOrder(raw.projects);
  if (projects) out.projects = projects;
  const selection = sanitizeSelection(raw.project);
  if (selection !== undefined) out.project = selection;
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

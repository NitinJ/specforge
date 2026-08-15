// Validation for the home-page "organize" actions: rename, tags, collection,
// project. Single source of truth for the shapes, reused by the API handlers
// (and tests).
//
// tags: a small set of freeform, trimmed, case-insensitively-deduped labels.
// collection: a single flat group name (single depth — never nested) or null.
// project: the same, one level up. A spec's address is the pair (project,
// collection), so the same collection name under two projects names two
// different collections.

const MAX_TITLE = 200;
const MAX_TAG = 40;
const MAX_TAGS = 24;
const MAX_COLLECTION = 60;
const MAX_PROJECT = 60;

/** A clean one-line title, or '' if not a usable string. */
export function sanitizeTitle(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

/** A clean tag list: trimmed, non-empty, case-insensitively deduped, capped. */
export function sanitizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** A single collection name, or null (empty/blank/non-string → null). */
export function sanitizeCollection(s) {
  if (typeof s !== 'string') return null;
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_COLLECTION) || null;
}

/**
 * A single project name, or null (empty/blank/non-string → null).
 *
 * Deliberately identical to sanitizeCollection rather than sharing one function:
 * the two are separate concepts whose limits can move apart, and a caller reads
 * better naming the level it means. MAX_PROJECT is its own constant for the same
 * reason.
 */
export function sanitizeProject(s) {
  if (typeof s !== 'string') return null;
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT) || null;
}

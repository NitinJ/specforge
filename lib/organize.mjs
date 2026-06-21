// Validation for the home-page "organize" actions: rename, tags, collection.
// Single source of truth for the shapes, reused by the API handlers (and tests).
//
// tags: a small set of freeform, trimmed, case-insensitively-deduped labels.
// collection: a single flat group name (single depth — never nested) or null.

const MAX_TITLE = 200;
const MAX_TAG = 40;
const MAX_TAGS = 24;
const MAX_COLLECTION = 60;

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

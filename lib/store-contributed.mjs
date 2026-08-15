// Where this machine's specs are listed, at <STORE_ROOT>/contributed.json.
//
// The contributor's half of a contribution. The creator's record is keyed by
// the spec token it was registered under, and that token can change: rotating
// a share mints a new one precisely so the old link dies. Without a memory of
// what was registered, a rotated spec could never be withdrawn — the entry
// would name a token nobody holds any more.
//
// So each row is {origin, token, specId, specToken, addedAt}: which project
// (by its origin and project token), which of our specs, and the spec token
// the entry over there is keyed by.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { storeRoot, contributedPath } from './store-paths.mjs';
import { isToken } from './tokens.mjs';

function sanitize(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (!isToken(rec.token) || !isToken(rec.specToken)) return null;
  if (typeof rec.origin !== 'string' || typeof rec.specId !== 'string') return null;
  let origin;
  try {
    const u = new URL(rec.origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    origin = u.origin;
  } catch {
    return null;
  }
  return {
    origin,
    token: rec.token,
    specId: rec.specId,
    specToken: rec.specToken,
    addedAt: typeof rec.addedAt === 'string' ? rec.addedAt : '',
    // Spec tokens this spec was previously listed under, whose entries could
    // not be retired yet (the creator's machine was down, or refused). Kept
    // until a later run clears them; without this the stale entry would live
    // on the project page forever with nobody holding its key.
    stale: Array.isArray(rec.stale) ? rec.stale.filter(isToken).slice(0, MAX_STALE) : [],
  };
}

/** How many un-retired tokens one row will carry before the oldest is dropped. */
const MAX_STALE = 20;

/** Every row, sanitized. Absent or corrupt reads as []. */
export function readContributed() {
  try {
    const raw = JSON.parse(readFileSync(contributedPath(), 'utf8'));
    return Array.isArray(raw) ? raw.map(sanitize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  mkdirSync(storeRoot(), { recursive: true });
  const tmp = `${contributedPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2));
  renameSync(tmp, contributedPath());
}

/**
 * Remember that a spec is listed in a project, under a given spec token.
 *
 * Keyed by (project origin, project token, specId): re-contributing the same
 * spec to the same project updates the remembered spec token rather than
 * adding a row, which is what makes a rotate-then-recontribute converge.
 *
 * @returns {{previous: string|null}} the spec token this replaces, if any —
 *   the caller uses it to retire the entry the creator still holds.
 */
export function rememberContribution({ origin, token, specId, specToken, stale }) {
  const rec = sanitize({ origin, token, specId, specToken, addedAt: new Date().toISOString() });
  if (!rec) throw new Error('contribute: cannot record this contribution locally');
  const rows = readContributed();
  const at = rows.findIndex((r) => r.origin === rec.origin && r.token === rec.token
    && r.specId === rec.specId);
  const previous = at >= 0 ? rows[at].specToken : null;
  // `stale` is authoritative when given: the caller reads the whole owed set
  // before it tries to retire any of it, so merging with what is already
  // stored would resurrect the tokens it just successfully cleared. Omitting
  // it leaves the row's list alone.
  const owed = Array.isArray(stale) ? stale : (at >= 0 ? rows[at].stale || [] : []);
  rec.stale = [...new Set(owed.filter(isToken).filter((t) => t !== rec.specToken))].slice(-MAX_STALE);
  if (at >= 0) rec.addedAt = rows[at].addedAt;
  if (at >= 0) rows[at] = rec;
  else rows.push(rec);
  writeAll(rows);
  return { previous: previous === rec.specToken ? null : previous };
}

/** Spec tokens this contribution still owes a retirement for. */
export function staleTokens({ origin, token, specId }) {
  const row = readContributed().find((r) => r.origin === origin && r.token === token
    && r.specId === specId);
  return row ? row.stale || [] : [];
}

/**
 * The spec token a spec was registered under in a project, or null.
 *
 * This, not the spec's current share token, is what a withdrawal must name.
 */
export function contributedToken({ origin, token, specId }) {
  const row = readContributed().find((r) => r.origin === origin && r.token === token
    && r.specId === specId);
  return row ? row.specToken : null;
}

/** Forget a contribution. @returns {boolean} whether a row was removed */
export function forgetContribution({ origin, token, specId }) {
  const rows = readContributed();
  const keep = rows.filter((r) => !(r.origin === origin && r.token === token
    && r.specId === specId));
  if (keep.length === rows.length) return false;
  writeAll(keep);
  return true;
}

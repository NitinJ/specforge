// Project-share records, at <STORE_ROOT>/project-shares.json.
//
// The shape and lifecycle mirror a spec's share.json (lib/store-share.mjs): a
// record holds a token rather than a URL, `published: false` means the share is
// down but the token is kept, and rotating is the only thing that changes a
// token. One file holds every record, because a project is a name on spec meta
// rather than a directory, so there is no per-project place for one to live.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { storeRoot, projectSharesPath } from './store-paths.mjs';
import { isToken } from './tokens.mjs';

/** The 60-character cap the organize layer and global prefs already enforce. */
const MAX_NAME = 60;

/** A project name as the store knows it: collapsed whitespace, trimmed, capped. */
export function normalizeProjectName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** Every record in the file, or {} when absent or unreadable. */
function readAll() {
  try {
    const raw = JSON.parse(readFileSync(projectSharesPath(), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(records) {
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(projectSharesPath(), JSON.stringify(records, null, 2));
}

/**
 * The publication, or null when this project is not published right now.
 *
 * @returns {{project:string, token:string, createdAt:string}|null}
 */
export function readProjectShare(name) {
  const key = normalizeProjectName(name);
  const rec = readAll()[key];
  if (!rec || !isToken(rec.token) || rec.published === false) return null;
  return { project: key, token: rec.token, createdAt: rec.createdAt };
}

/**
 * This project's token, published or not. The token outlives an unshare for the
 * same reason a spec's does: the URL made from it is already in someone's chat
 * history, and a re-share has to hand that URL back.
 *
 * @returns {string|null}
 */
export function readProjectShareToken(name) {
  const rec = readAll()[normalizeProjectName(name)];
  return rec && isToken(rec.token) ? rec.token : null;
}

export function writeProjectShare(name, record) {
  const key = normalizeProjectName(name);
  const all = readAll();
  // Contributed entries outlive an unshare for the same reason the token does:
  // a re-share has to bring the project back as it was, not as an empty page.
  const entries = Array.isArray(all[key] && all[key].entries) ? all[key].entries : undefined;
  all[key] = { ...record, published: true, ...(entries ? { entries } : {}) };
  writeAll(all);
  return { project: key, token: record.token, createdAt: record.createdAt };
}

/**
 * Stop publishing, keeping the token.
 *
 * @returns {boolean} whether the project was published
 */
export function clearProjectShare(name) {
  const key = normalizeProjectName(name);
  const all = readAll();
  const rec = all[key];
  if (!rec) return false;
  const was = rec.published !== false && isToken(rec.token);
  all[key] = { ...rec, published: false };
  writeAll(all);
  return was;
}

/** Every currently-published record, for `shares` and for restore(). */
export function listProjectShares() {
  return Object.entries(readAll())
    .filter(([, rec]) => rec && isToken(rec.token) && rec.published !== false)
    .map(([project, rec]) => ({ project, token: rec.token, createdAt: rec.createdAt }));
}

// ------------------------------------------------------------ contributions
//
// A contribution is someone else's spec listed in a project you created. The
// entry is a pointer — {origin, token, title, owner} — and the spec it names
// stays on its contributor's machine, published under their own spec token. So
// the creator's store gains a metadata row and never another machine's HTML
// (spec 82f5dabccf, D9), which is what keeps one writable copy, one comment
// home, and the contributor's agent's context where they belong.

/** How many entries one project will hold, and how long the free text may be. */
export const MAX_CONTRIBUTIONS = 200;
const MAX_TITLE = 120;
const MAX_OWNER = 60;

/** An origin an entry may link to: http(s), no path, no credentials. */
function validOrigin(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:')
      && u.username === '' && u.password === ''
      && u.pathname === '/' && !u.search && !u.hash;
  } catch {
    return false;
  }
}

const clean = (raw, cap) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

/** Exactly the four fields plus a stamp; anything else a caller sends is dropped. */
function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isToken(raw.token) || !validOrigin(raw.origin)) return null;
  return {
    origin: new URL(raw.origin).origin,
    token: raw.token,
    title: clean(raw.title, MAX_TITLE) || 'Untitled',
    owner: clean(raw.owner, MAX_OWNER) || 'someone',
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString(),
  };
}

/** The entries on a project, sanitized. Absent, corrupt or unknown reads as []. */
export function listContributions(name) {
  const rec = readAll()[normalizeProjectName(name)];
  if (!rec || !Array.isArray(rec.entries)) return [];
  return rec.entries.map(sanitizeEntry).filter(Boolean).slice(0, MAX_CONTRIBUTIONS);
}

/**
 * Register a contributed spec, or refresh the row of one already listed.
 *
 * Keyed by origin+token, so re-contributing after a rename updates the title
 * rather than adding a second row. Refused unless the project is shared: an
 * entry on an unshared project would be a row nothing serves.
 */
export function addContribution(name, entry) {
  const key = normalizeProjectName(name);
  const all = readAll();
  const rec = all[key];
  if (!rec || !isToken(rec.token) || rec.published === false) {
    throw new Error(`contribute: ${key} is not a shared project`);
  }
  const clean_ = sanitizeEntry(entry);
  if (!clean_) throw new Error('contribute: origin or token is malformed');

  const entries = Array.isArray(rec.entries) ? rec.entries.map(sanitizeEntry).filter(Boolean) : [];
  const at = entries.findIndex((e) => e.origin === clean_.origin && e.token === clean_.token);
  if (at >= 0) {
    entries[at] = { ...clean_, addedAt: entries[at].addedAt };
  } else {
    if (entries.length >= MAX_CONTRIBUTIONS) {
      throw new Error(`contribute: entry limit (${MAX_CONTRIBUTIONS}) reached for ${key}`);
    }
    entries.push(clean_);
  }
  all[key] = { ...rec, entries };
  writeAll(all);
  return entries[at >= 0 ? at : entries.length - 1];
}

/**
 * Drop an entry by the spec token it was registered with.
 *
 * The same call serves both directions: a contributor withdrawing presents the
 * token they hold, and the creator pruning presents one they can see in
 * `shares`. Neither needs an account, because the token is the handle.
 *
 * @returns {boolean} whether anything was removed
 */
export function removeContribution(name, token) {
  const key = normalizeProjectName(name);
  const all = readAll();
  const rec = all[key];
  if (!rec || !Array.isArray(rec.entries)) return false;
  const entries = rec.entries.map(sanitizeEntry).filter(Boolean);
  const keep = entries.filter((e) => e.token !== token);
  if (keep.length === entries.length) return false;
  all[key] = { ...rec, entries: keep };
  writeAll(all);
  return true;
}

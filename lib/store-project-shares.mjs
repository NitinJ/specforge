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
  all[key] = { ...record, published: true };
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

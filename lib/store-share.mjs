// The record of a published spec, at ~/.specforge/specs/<id>/share.json.
//
// Absent means the spec is not published. The file exists so a publication is
// visible without asking the daemon: the index and the spec's own top bar read
// it to show the badge, and `shares` reads it to list what is public. With no
// expiry, that visibility is the only thing standing between a share and a
// forgotten public URL.
//
// The record holds a token, not a URL. One tunnel now serves every published
// spec, so the origin belongs to the tunnel record rather than to any one spec,
// and a spec's public address is composed as <origin>/s/<token>. Keeping the
// origin out of here is what lets the tunnel change without rewriting a record
// per published spec.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { specDir, sharePath } from './store-paths.mjs';
import { isToken } from './tokens.mjs';

/** Parsed share.json, or null when absent or unreadable. */
function readRaw(id) {
  try {
    const raw = JSON.parse(readFileSync(sharePath(id), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The publication, or null when the spec is not published right now.
 *
 * @returns {{specId:string, token:string, createdAt:string}|null}
 */
export function readShare(id) {
  const raw = readRaw(id);
  if (!raw || !isToken(raw.token) || raw.published === false) return null;
  return raw;
}

/**
 * This spec's token, published or not.
 *
 * The token outlives an unshare, because a URL that has to survive a reboot has
 * to survive an accidental unshare too, and that is the likelier event.
 * Unpublishing stops serving the link; rotating is what changes it.
 *
 * @returns {string|null}
 */
export function readShareToken(id) {
  const raw = readRaw(id);
  return raw && isToken(raw.token) ? raw.token : null;
}

/**
 * A record from the scheme that gave every spec its own tunnel and port.
 *
 * Such a record cannot be honoured: the port died with the daemon that opened
 * it, and nothing creates a per-spec tunnel any more. The pid is the one part
 * still worth having, because a cloudflared child outlives a SIGKILLed parent
 * and this is the only remaining route back to it.
 *
 * @returns {{pid:number|null}|null} null when the record is current or absent
 */
export function isLegacyShare(id) {
  const raw = readRaw(id);
  if (!raw || isToken(raw.token)) return null;
  if (typeof raw.url !== 'string' && !Number.isInteger(raw.port)) return null;
  return { pid: Number.isInteger(raw.pid) ? raw.pid : null };
}

export function writeShare(id, record) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(sharePath(id), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Stop publishing, keeping the token.
 *
 * The file is rewritten rather than deleted, because deleting it would throw
 * away the one thing that makes a re-share return the URL people already have.
 *
 * @returns {boolean} whether the spec was published
 */
export function clearShare(id) {
  const raw = readRaw(id);
  if (!raw) return false;
  const was = raw.published !== false && isToken(raw.token);
  if (!isToken(raw.token)) {
    // A legacy record has no token worth keeping.
    try { rmSync(sharePath(id)); } catch { /* already gone */ }
    return false;
  }
  writeFileSync(sharePath(id), JSON.stringify({ ...raw, published: false }, null, 2));
  return was;
}

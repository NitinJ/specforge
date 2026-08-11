// The record of a live publication, at ~/.specforge/specs/<id>/share.json.
//
// Absent means the spec is not published. The file exists so a live publication
// is visible without asking the daemon: the index and the spec's own top bar
// read it to show the badge, and `shares` reads it to list what is public. With
// no expiry, that visibility is the only thing standing between a share and a
// forgotten public URL.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { specDir, sharePath } from './store-paths.mjs';

/** @returns {{specId,url,port,pid,createdAt}|null} null when unpublished or unreadable */
export function readShare(id) {
  try {
    const raw = JSON.parse(readFileSync(sharePath(id), 'utf8'));
    if (!raw || typeof raw.url !== 'string' || !Number.isInteger(raw.port)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeShare(id, record) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(sharePath(id), JSON.stringify(record, null, 2));
  return record;
}

/** @returns {boolean} whether a record was there to remove */
export function clearShare(id) {
  try {
    rmSync(sharePath(id));
    return true;
  } catch {
    return false;
  }
}

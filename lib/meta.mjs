// meta.json IO for the v2 global spec store.
//
// Each spec carries a meta.json at ~/.specforge/specs/<id>/meta.json describing
// its lifecycle + session ownership. Plain writes (KISS — single user, no CAS;
// see design §4/§6). Path resolution lives in store-paths.mjs; this module is
// pure IO over the per-spec dir.
//
// Shape:
//   { id, title, status, origin, attachedSession, heartbeat, created, updated }

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { specDir, metaPath, specsDir } from './store-paths.mjs';

/** A fresh meta object for a new spec (status draft, unattached). */
export function defaultMeta({ id, title, origin = null }) {
  const now = Date.now();
  return {
    id,
    title: title || 'Untitled',
    status: 'draft',
    origin,
    attachedSession: null,
    heartbeat: 0,
    created: now,
    updated: now,
  };
}

/** Read a spec's meta.json, or null if it doesn't exist / is unreadable. */
export function readMeta(id) {
  try {
    return JSON.parse(readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
}

/** Write a spec's meta.json (plain write; bumps `updated`). */
export function writeMeta(id, meta) {
  mkdirSync(specDir(id), { recursive: true });
  const out = { ...meta, updated: Date.now() };
  writeFileSync(metaPath(id), JSON.stringify(out, null, 2));
  return out;
}

/** All store specs' meta objects (skips dirs without a readable meta.json). */
export function listSpecs() {
  const root = specsDir();
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!existsSync(join(root, e.name, 'meta.json'))) continue;
    const meta = readMeta(e.name);
    if (meta) out.push(meta);
  }
  return out;
}

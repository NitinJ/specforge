// Persistence for the spec-nav index. The index is a pure function of the spec
// HTML, so it is regenerated wholesale on every spec save (no diffing) and stored
// under <specsDir>/.specforge/idx/<specId>.idx.json — alongside the other
// SpecForge state, never inside the served HTML.

import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { getTitle, getStatus } from './spec.mjs';
import { buildIndex } from './spec-nav.mjs';

/** Stable short id for a spec, derived from its (relative) path. */
export function specId(relPath) {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 10);
}

/** Path to a spec's index file under the SpecForge state dir. */
export function indexPath(specsDir, specId) {
  return join(specsDir, '.specforge', 'idx', `${specId}.idx.json`);
}

/**
 * Build the full on-disk index document for a spec file.
 * @param {{file:string, relPath:string, id:string}} spec
 */
export function buildIndexDoc(spec, html) {
  const core = buildIndex(html);
  return {
    specId: spec.id,
    path: spec.relPath,
    title: getTitle(html),
    status: getStatus(html),
    generatedAt: new Date().toISOString(),
    sourceBytes: Buffer.byteLength(html, 'utf8'),
    ...core,
  };
}

/**
 * Regenerate and persist the index for a spec. Idempotent and cheap.
 * @param {string} specsDir
 * @param {{file:string, relPath:string, id:string}} spec
 * @returns {string} the path written
 */
export function writeIndex(specsDir, spec) {
  const html = readFileSync(spec.file, 'utf8');
  const doc = buildIndexDoc(spec, html);
  const p = indexPath(specsDir, spec.id);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2));
  return p;
}

/**
 * Load a spec's index, regenerating it if missing or stale (spec newer than idx).
 * Keeps the CLI correct even when the server isn't running to emit on save.
 * @returns {object} the index document
 */
export function loadIndex(specsDir, spec) {
  const p = indexPath(specsDir, spec.id);
  let fresh = false;
  try {
    fresh = statSync(p).mtimeMs >= statSync(spec.file).mtimeMs;
  } catch {
    fresh = false;
  }
  if (fresh) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      /* fall through to rebuild */
    }
  }
  writeIndex(specsDir, spec);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Spec discovery + stable ids for the review server.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { getTitle, getStatus } from './spec.mjs';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.specforge', '.github']);

/** Stable short id derived from a spec's path relative to the specs dir. */
export function specId(relPath) {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 10);
}

/** Recursively list .html files under a directory (skipping noise dirs). */
export function listHtmlFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push(...listHtmlFiles(join(dir, e.name)));
    } else if (e.isFile() && extname(e.name).toLowerCase() === '.html') {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/**
 * Build the index of specs under specsDir.
 * @returns {{id:string, file:string, relPath:string, title:string, status:string, mtime:number}[]}
 */
export function buildIndex(specsDir) {
  const items = [];
  for (const file of listHtmlFiles(specsDir)) {
    let html;
    try {
      html = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const relPath = relative(specsDir, file);
    items.push({
      id: specId(relPath),
      file,
      relPath,
      title: getTitle(html),
      status: getStatus(html),
      mtime: safeMtime(file),
    });
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

/** Look up a single spec by id, or null. */
export function resolveSpec(specsDir, id) {
  return buildIndex(specsDir).find((s) => s.id === id) || null;
}

function safeMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Per-spec comment store for the v2 global store — the store-id-keyed analogue
// of v1's specsDir-keyed comments.mjs. Threads live at
// ~/.specforge/specs/<id>/comments.json. The pure thread operations
// (createThread/addComment/editComment/resolveThread/findThread) are shared with
// v1 — only load/save are rooted at the global store here.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { specDir, commentsPath } from './store-paths.mjs';

export {
  createThread, addComment, editComment, resolveThread, findThread,
} from './comments.mjs';

/** Load a spec's comment store, or a fresh empty store if none exists yet. */
export function loadComments(id) {
  try {
    const raw = JSON.parse(readFileSync(commentsPath(id), 'utf8'));
    if (!Array.isArray(raw.threads)) raw.threads = [];
    return raw;
  } catch {
    return { specId: id, threads: [] };
  }
}

export function saveComments(id, store) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(commentsPath(id), JSON.stringify(store, null, 2));
  return store;
}

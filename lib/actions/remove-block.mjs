// Delete one block from a stored spec.
//
// Unlike removing a draft, the comment threads on the block are LEFT. A draft
// and its threads are one thing — the discussion is about a proposal that no
// longer exists — but a thread on a paragraph is a conversation between people,
// and deleting the paragraph does not settle it. The reconcile already has a
// name for a thread whose block is gone: it renders as an orphan, and the reader
// can read it and resolve it.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { readSpecHtml, writeSpecHtml } from '../store.mjs';
import { deleteBlock } from './delete-block.mjs';

/**
 * Remove a block from a spec.
 *
 * @param {string} id the spec
 * @param {{section:string, tag:string, text:string}} what the reader pointed at
 * @returns {{section:string, tag:string}}
 * @throws when the block does not resolve to exactly one element
 */
export function removeBlock(id, what) {
  // Throws before the write when this does not identify exactly one block, so a
  // refused request leaves the file as it was. Read and write are adjacent for
  // the same reason as in remove-aside: nothing runs in between that could take
  // long enough for another writer to land.
  const cut = deleteBlock(readSpecHtml(id), what);
  writeSpecHtml(id, cut.html);
  return { section: cut.section, tag: cut.tag };
}

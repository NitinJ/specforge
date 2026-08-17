// Delete an aside from the store: the section and its comment threads.
//
// Order matters. The threads go first. An aside cut from the spec while its
// threads are still in comments.json leaves them anchored to a section id that
// no longer exists, and the reconcile re-attaches an orphaned thread to whatever
// text is nearest — so the reader gets their comment back, attached to something
// they never wrote it about. Deleting the thread with its draft is the outcome
// §10 already specified; leaving one behind is the failure.
//
// Nothing is written until the delete is known to be legal, so a refused request
// leaves both files exactly as they were.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { readSpecHtml, writeSpecHtml } from '../store.mjs';
import { mutateComments } from '../store-comments.mjs';
import { deleteAside } from './delete-aside.mjs';

/** The section a thread is anchored in, or null. */
function sectionOf(t) {
  const path = t && t.anchor && t.anchor.block && t.anchor.block.sectionPath;
  return (Array.isArray(path) && path[0]) || null;
}

/**
 * Remove an aside and everything anchored to it.
 *
 * @param {string} id the spec
 * @param {string} asideId the aside section
 * @returns {{aside:string, section:string, threads:number}} threads is how many
 *   were deleted with it
 * @throws when the id names nothing, or names a section that is not an aside
 */
export function removeAside(id, asideId) {
  // Throws before anything is written when this is not a legal target, which is
  // what keeps a refused request from leaving half of it done.
  const cut = deleteAside(readSpecHtml(id), asideId);

  const threads = mutateComments(id, (store) => {
    const before = store.threads.length;
    store.threads = store.threads.filter((t) => sectionOf(t) !== asideId);
    return before - store.threads.length;
  });

  writeSpecHtml(id, cut.html);
  return { aside: cut.aside, section: cut.section, threads };
}

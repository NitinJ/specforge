// Delete an aside from the store: the section and its comment threads.
//
// Two files change and there is no transaction across them, so the order is
// chosen by which half-done state is survivable.
//
//   spec first, threads fail  → threads anchored to an id that is gone. The
//                               reconcile re-attaches them to the nearest text,
//                               so the reader sees a comment on something they
//                               did not write it about. Visible, and fixable by
//                               resolving it.
//   threads first, spec fails → the draft is still on screen and the comments
//                               on it are gone for good. Silent and permanent:
//                               nothing in the store is versioned.
//
// So the spec goes first. An earlier version of this went the other way, on the
// reasoning that an orphaned thread is worse than a deleted one — true of the
// steady state, and the wrong question to ask about a failure.
//
// The write also follows its read with nothing in between, which is what keeps
// the window for clobbering a concurrent spec edit down to the arithmetic
// between them. `mutateComments` takes a per-spec lock and can wait seconds;
// holding a parsed copy of the spec across that wait was the real exposure.
// This is the same read-modify-write `renameSpec` has always done, and it is not
// a compare-and-swap: a spec written by an agent in that window is still lost.
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
  // what keeps a refused request from leaving half of it done. Read and write
  // are adjacent on purpose: see the note above.
  const cut = deleteAside(readSpecHtml(id), asideId);
  writeSpecHtml(id, cut.html);

  const threads = mutateComments(id, (store) => {
    const before = store.threads.length;
    store.threads = store.threads.filter((t) => sectionOf(t) !== asideId);
    return before - store.threads.length;
  });

  return { aside: cut.aside, section: cut.section, threads };
}

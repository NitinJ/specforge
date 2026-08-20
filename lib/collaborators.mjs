// Who else has worked on a set of specs.
//
// The shared project page names the people a reader might recognise — the
// reviewers — and not the two parties that are always there. Both exclusions
// fall out of how a name is acquired, because the store keeps no identity
// record and there is nothing to look anyone up in:
//
//   - The agent is excluded by `kind`. Authors are free text (mentions.mjs), so
//     a person may legitimately be called claude and only `kind` is
//     authoritative. This is the same rule mine-comments.mjs uses.
//   - The owner is excluded because they are never named. review.js opens the
//     welcome dialog only on a published copy, and it will not close without a
//     name, so every reviewer arriving through a shared link is named. The
//     owner's own browser is never asked, so their writes carry no author and
//     store-api records the pre-authors default, OWNER_DEFAULT below.
//
// The blind spot that follows: an owner who opens their own published link is
// asked like anyone else, and the name they type would list them here. Nothing
// in the store can tell that name from a reviewer's.

import { loadComments } from './store-comments.mjs';
import { kindOf } from './comments.mjs';

/**
 * The author recorded for a write that carried no name — store-api's
 * `authorFor` default, which in practice means the owner's own browser.
 */
export const OWNER_DEFAULT = 'human';

/**
 * The external humans who have commented on these specs, busiest first.
 *
 * Names are folded case-insensitively before counting. A published spec is its
 * own origin, so the welcome dialog asks once PER LINK and a reviewer working
 * through four specs types their name four times; without folding, one person
 * who capitalised differently on the fourth is a fourth collaborator. The
 * spelling reported is the first one seen, reading the specs in the order given.
 *
 * @param {string[]} specIds
 * @returns {{name:string, comments:number, specs:number}[]}
 */
export function projectCollaborators(specIds) {
  const by = new Map(); // lowercased name -> { name, comments, specs:Set }
  for (const id of specIds || []) {
    // A spec with no comment store reads as an empty one, so a project of specs
    // nobody has commented on is an empty list rather than a failure.
    for (const thread of loadComments(id).threads || []) {
      for (const comment of thread.comments || []) {
        if (kindOf(comment) !== 'human') continue;
        const name = typeof comment.author === 'string' ? comment.author.trim() : '';
        if (!name || name === OWNER_DEFAULT) continue;
        const key = name.toLowerCase();
        if (!by.has(key)) by.set(key, { name, comments: 0, specs: new Set() });
        const row = by.get(key);
        row.comments += 1;
        row.specs.add(id);
      }
    }
  }
  return [...by.values()]
    .map((r) => ({ name: r.name, comments: r.comments, specs: r.specs.size }))
    // Volume first, then name, so the order is stable across requests rather
    // than following whatever order the specs happened to be read in.
    .sort((a, b) => b.comments - a.comments || a.name.localeCompare(b.name));
}

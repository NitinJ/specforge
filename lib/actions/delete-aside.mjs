// Remove an aside from a spec.
//
// Delete is the one action the browser answers by changing the document, and
// that needs saying out loud, because inline section editing was taken out of
// SpecForge in v0.2.47 on the grounds that a browser editing spec source is not
// what the review layer is for. This is a different thing wearing a similar
// coat: the target is a section SpecForge wrote, the operation carries no
// source for a reader to get wrong, and the only decision is which section.
//
// The guard is that decision. A section without `data-sf-aside` is refused, so
// a request naming a section of the reader's own writing cannot remove it. Every
// other protection here is about not corrupting the file around the cut.
//
// Everything else about Delete stayed as it was: it deletes the draft and its
// threads, the same as deleting any commented section.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';
import { sectionRange } from './section-span.mjs';

/**
 * Cut an aside out of a spec.
 *
 * @param {string} html the spec
 * @param {string} asideId the section to remove
 * @returns {{html:string, aside:string, section:string}}
 * @throws when the id names nothing, or names a section that is not an aside
 */
export function deleteAside(html, asideId) {
  const at = sectionRange(html, asideId);
  // An unclosed section reports as absent rather than as a range, because
  // cutting to a close tag that belongs to something else takes the rest of the
  // document with it.
  if (!at) throw new Error(`delete: no section ${JSON.stringify(asideId)} in this spec`);

  const section = getAttr(at.attrs, 'data-sf-aside');
  if (!section) {
    throw new Error(
      `delete: ${JSON.stringify(asideId)} is not an aside; only a section SpecForge wrote can be deleted this way`,
    );
  }

  // The whitespace that preceded it goes too, so deleting every aside on a
  // section leaves the file as it was rather than with a growing gap where
  // drafts used to be.
  let start = at.start;
  while (start > 0 && /\s/.test(html[start - 1])) start -= 1;

  return { html: html.slice(0, start) + html.slice(at.end), aside: asideId, section };
}

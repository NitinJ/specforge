// What importing an aside acts on, and what it does to it.
//
// The instruction used to say "merge this aside into the section above it".
// Both halves were wrong. It named a POSITION where the aside records an
// IDENTITY, so an aside sitting after another aside merged into that other
// draft. And it worked on the section when the request was about a block: ask
// for a diagram of one paragraph in a twelve-paragraph section, and the result
// landed wherever the agent chose.
//
// The aside already carries the answer. `data-sf-aside` names the section it
// came from, `data-sf-block` names the block, and `data-sf-action` names the
// action whose own import guidance says what folding this kind of draft in
// actually means.
//
// That guidance replaced a merge/replace flag, which was hiding six different
// behaviours behind two words. A diagram supersedes the prose it was drawn from;
// a plain-language rewrite sits beside it; a verification report is not spec
// prose at all and imports as corrections to the claims it found wrong. How much
// of a section a draft supersedes is a judgement about that draft, so the agent
// makes it, under one rule: cut only what the draft carries forward.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';
import { actionById } from './all.mjs';

/** The opening tag of `<section id="…">`, or null. */
function openTagOf(html, id) {
  const re = /<section\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) if (getAttr(m[1], 'id') === id) return m[1];
  return null;
}

/**
 * Where an import lands and what it does there.
 *
 * An aside outlives edits to the document around it, so both names it carries
 * are checked before they become an instruction. A section that has been renamed
 * or deleted resolves to `unresolved` rather than to an instruction aimed at
 * nothing, and a block the registry no longer lists is dropped rather than named
 * as a placement the agent cannot find.
 *
 * What is not checkable: an id that was deleted and later taken by a different
 * section. The aside names a string and the document holds that string, and
 * nothing records which section held it when the aside was written. The bound on
 * it is the lint's unique-section-ids, which at least means one section owns the
 * name.
 *
 * @param {string} html the spec
 * @param {string} asideId the aside being imported
 * @param {{bids?:Set<string>}} [opts] live block ids, when the caller has the
 *   registry. Omitted means unknown rather than deleted: the registry is derived
 *   and disposable, and dropping a good anchor for want of one is a worse
 *   default than keeping a stale one.
 * @returns {null | {aside:string, section:string, block:string|null,
 *   action:string|null, resolved:boolean, guidance:string, next:string}}
 */
export function importTarget(html, asideId, { bids } = {}) {
  const attrs = openTagOf(html, asideId);
  if (!attrs) return null;
  const section = getAttr(attrs, 'data-sf-aside');
  if (!section) return null; // a section, not an aside
  const named = getAttr(attrs, 'data-sf-block');
  const block = named && (!bids || bids.has(named)) ? named : null;
  const actionId = getAttr(attrs, 'data-sf-action');
  const action = actionById(actionId);
  const resolved = !!openTagOf(html, section);
  // What folding this draft in means, from the action that produced it: a
  // diagram supersedes the prose it was drawn from, a plain-language rewrite
  // sits beside it, a verification report is not spec prose at all. An aside
  // written under an id the registry has since lost has no guidance to give, and
  // the general instruction on @import is what is left.
  const guidance = (action && action.importInstruction) || '';

  const next = !resolved
    ? `This aside came from the section \`${section}\`, and no section in the spec has that id now: it was `
      + 'renamed or deleted after the draft was written. Do not import it into whichever section looks '
      + 'closest. Reply on the thread saying the source is gone, and ask whether the draft belongs '
      + 'somewhere else or should be deleted.'
    // "Import into", not "fold the content in": for two of the six actions the
    // draft is not content that goes into the document at all. A verification
    // report imports as corrections to the claims it found wrong, and a decision
    // aid imports as the decision rather than the option list.
    : `Import this aside into the section \`${section}\`, `
      + (block
        ? `around the block \`${block}\` it was asked about, `
        : 'where it belongs rather than appending it, ')
      + 'then delete the aside. '
      + (guidance
        // The whole point of resolving here: the agent is handed what this
        // particular kind of draft does to the section, rather than a general
        // sentence about importing and a lookup it has to decide to perform.
        ? `It came from ${action.label}, so: ${guidance} `
        : 'The action that wrote this aside is no longer in the registry, so there is no guidance for '
          + 'its content: fold it in without cutting anything, and say in your reply that you did. ')
      + 'Cut only what the draft carries forward. Comment threads on the imported blocks travel with '
      + 'them, because they anchor to blocks rather than to the aside.';

  return { aside: asideId, section, block, action: actionId || null, resolved, guidance, next };
}

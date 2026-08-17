// The eleven actions, in the order the menu shows them.
//
// Chosen by mining 318 review comments across 22 specs: 242 action instances in
// 212 of them, resolving to 22 distinct actions. These eleven are 166 of those
// instances, 69%, across all eight buckets. The count on each line is how many
// times it was asked for, which is why it is here rather than in a table
// somewhere: an action with a low count has to justify itself on being a
// distinct intent instead.
//
// The instruction is the whole value. What a menu entry carries is a written
// standard the agent applies every time, not the word on the button, and several
// of these are longer than the comment a human would have typed. That is the
// point rather than an accident.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §6.

import { defineAction, GROUPS } from './index.mjs';

/**
 * Every action, in menu order: local first, then the spec-wide ones.
 *
 * Declaration order IS menu order, so reading this file top to bottom is reading
 * the menu. That only holds because the groups run in the same order here as in
 * GROUPS; the renderer sorts by group regardless, and letting the two drift
 * would make this file lie about what the reader sees.
 *
 * Within a group, by how often the action was asked for in the corpus. The
 * groups themselves put every entry that rewrites your text under `change`, so
 * the actions that edit a section never sit between the ones that only draft
 * beside it.
 */
export const ALL_ACTIONS = [
  defineAction({
    id: 'explain_simply',
    label: 'Explain simply',
    icon: '💡',
    kind: 'aside',
    scope: 'local',
    group: 'understand',
    // 24 instances, the most asked in the corpus.
    instruction: 'Rewrite this for a reader who does not have this codebase in their head. '
      + 'Define or replace every term of art at first use. Leave the original prose alone: a spec '
      + 'is a technical document and the precise wording is often the point, so the plain-language '
      + 'version sits under it rather than over it.',
    importInstruction: 'Add it beside the original, never in place of it. The precise wording of a '
      + 'spec is usually load bearing, and a plain-language version is a second way in rather than a '
      + 'better one, so nothing here is superseded and nothing is cut.',
  }),

  defineAction({
    id: 'visualize',
    label: 'Visualize',
    icon: '⊞',
    kind: 'aside',
    scope: 'local',
    group: 'understand',
    // The one action whose output supersedes its input, and the reason the
    // import guidance is per action rather than a flag: how much it supersedes
    // is a judgement about this particular diagram, not a property of Visualize.
    // 23 instances.
    instruction: 'Choose the form this content actually wants, a diagram, a table or a mock, and '
      + 'build it. Pick the form yourself rather than asking; that judgement is most of the value '
      + 'here. Every node and edge you draw must appear in the prose it came from.',
    importInstruction: 'A diagram supersedes the prose it was drawn from, so the blocks it carries '
      + 'forward come out and the diagram goes in their place. Decide which those are by reading it '
      + 'against the section: if every node and edge came from three paragraphs of twelve, those '
      + 'three go and the other nine stay; if it carries the whole section, the whole section goes '
      + 'and you keep the id and the heading. Anything the diagram does not say stays written down.',
  }),

  defineAction({
    id: 'go_deeper',
    label: 'Go deeper',
    icon: '🔎',
    kind: 'aside',
    scope: 'local',
    group: 'understand',
    // 22 instances, and the largest output of any action in the corpus.
    instruction: 'For each named thing here: what it is, why it exists, what it is for, and when '
      + 'it was added and by whom where that is knowable. Those four questions are nearly always '
      + 'what was meant, so answer them without being asked.',
    importInstruction: 'This is detail that was not there before, so it supersedes nothing: place '
      + 'it after the block it expands and cut none of the surrounding prose. It is also the '
      + 'longest output any action produces, so fold it into the section\'s own register rather '
      + 'than pasting a second document underneath the first.',
  }),

  defineAction({
    id: 'show_an_example',
    label: 'Show an example',
    icon: '❝',
    kind: 'aside',
    scope: 'local',
    group: 'understand',
    // 13 instances. What gets reached for when explain simply was not enough.
    instruction: 'Build a worked example big enough to carry the concept, in code where the '
      + 'subject is code. Illustrative rather than normative: it shows how the thing behaves, it '
      + 'does not add a requirement.',
    importInstruction: 'Place it after the concept it illustrates and cut nothing: an example '
      + 'shows how the rule behaves and is not a replacement for stating the rule. Keep it marked '
      + 'as illustrative when you fold it in, so a later reader does not read it as a requirement '
      + 'the spec is making.',
  }),

  defineAction({
    id: 'verify_against_code',
    label: 'Verify against code',
    icon: '✓',
    kind: 'aside',
    scope: 'local',
    group: 'check',
    needsDetail: true,
    // 20 instances. Reports rather than corrects: a confident fix built on a
    // misreading turns a true claim into a false one, silently.
    instruction: 'Check the claims here against the tree and report what disagrees: the claim, '
      + 'what the code actually does, and the file and line it is in. Do not correct the spec. '
      + 'If the comment did not name which claim to check or where to look, say which claims you '
      + 'checked and ask, rather than guessing at the one that was meant.',
    importInstruction: 'The aside is a report, not spec prose, and importing it does not mean '
      + 'pasting it in. Correct each claim it found wrong, in place, in the words the section '
      + 'already uses, and leave the file and line references behind: they belong to the check '
      + 'rather than to the document. If the report found nothing wrong there is nothing to '
      + 'import, so say so and delete the aside instead.',
  }),

  defineAction({
    id: 'help_me_decide',
    label: 'Help me decide',
    icon: '⚖',
    kind: 'aside',
    scope: 'local',
    group: 'check',
    // 15 instances. Named for what the reader wants rather than what the spec
    // lacks.
    instruction: 'Give the reader everything the call needs: what is being decided, why it '
      + 'matters, what each option costs, what the risks are, and what happens either way. Plain '
      + 'words first, then the technical terms the choice turns on. Never leave it open ended: '
      + 'offer options with their consequences stated, so a one-word answer settles it.',
    importInstruction: 'What gets imported is the decision, not the options. Read the thread for '
      + 'the answer the reader gave, write it into the spec as a decision with its reason and its '
      + 'cost, and replace whatever the section said while the question was open. If no answer has '
      + 'been given yet there is nothing to import: say so and ask, rather than importing an '
      + 'option list into a document that is supposed to have settled it.',
  }),

  defineAction({
    id: 'restructure',
    label: 'Restructure',
    icon: '☰',
    kind: 'in-place',
    scope: 'local',
    group: 'change',
    // 16 instances. The most destructive entry in the menu: it rewrites
    // everything in scope and nothing keeps the old version (D4).
    instruction: 'This section is not presenting its information well and is not organised well. '
      + 'Rebuild it on a deliberate pattern: top-down from the concept, bottom-up from the parts, '
      + 'or another established shape that fits the material. One structure throughout, not a mix. '
      + 'Keep every claim the section makes; this changes the order and the shape, not the content.',
  }),

  defineAction({
    id: 'tighten',
    label: 'Tighten',
    icon: '✂',
    kind: 'in-place',
    scope: 'local',
    group: 'change',
    // 4 instances, the lowest local count. Earns its place on being a distinct
    // intent from deleting: nothing here is stale, there is just too much of it.
    instruction: 'Cover the same ground in fewer words. Cut the excessive detail and keep what the '
      + 'section is for. Nothing here is stale, so nothing should be dropped outright; this is '
      + 'compression, not deletion.',
  }),

  // 19 instances with Tighten, the Compression bucket. Last in its group and in
  // the menu's local half, because it is the only entry that removes the
  // reader's own writing and a destructive item sitting mid-list is one you hit
  // reaching for the one below it.
  //
  // `direct`: the browser answers it, like Delete on a draft. There is no
  // judgement in cutting a paragraph you have decided is stale, and routing it
  // through the agent would mean waiting for a batch to run before a line you
  // already rejected leaves the page.
  defineAction({
    id: 'delete_block',
    label: 'Delete',
    icon: '✕',
    kind: 'direct',
    scope: 'local',
    group: 'change',
    // No instruction, for the same reason Copy link has none: nobody reads one.
    // The browser posts the block's tag and text, the server finds exactly that
    // block inside the named section and refuses anything ambiguous.
  }),

  defineAction({
    id: 'copy_link',
    label: 'Copy link',
    icon: '🔗',
    kind: 'direct',
    scope: 'local',
    // No instruction: the browser reads an anchor that already exists. The only
    // direct action left after review, because Edit and Delete would both mean
    // the browser writing the spec file.
  }),

  defineAction({
    id: 'fix_the_naming',
    label: 'Fix the naming',
    icon: '🏷',
    kind: 'in-place',
    scope: 'global',
    group: 'whole',
    needsDetail: true,
    // 12 instances. Global because a rename applied to one section leaves the
    // document saying two things, which is the complaint being answered.
    instruction: 'Replace one term with another everywhere it appears, including headings, '
      + 'tables, diagrams and the table of contents, and leave no instance of the old one. Use the '
      + "reader's exact term rather than a variant of it. If the comment did not name both terms, "
      + 'ask which, rather than inferring a rename from the prose.',
  }),

  defineAction({
    id: 'consistency_pass',
    label: 'Consistency pass',
    icon: '⇄',
    kind: 'in-place',
    scope: 'global',
    group: 'whole',
    // 11 instances. Global because it needs both halves of a contradiction, so
    // it is meaningless run on one block.
    instruction: 'Read the whole spec and fix what contradicts itself: claims made twice, '
      + 'decisions stated two ways, numbers that disagree between a table and the prose around it, '
      + 'and table-of-contents entries that no longer match the sections. Report what you changed '
      + 'rather than only that you passed.',
  }),

  defineAction({
    id: 'canonicalize',
    label: 'Canonicalize',
    icon: '📜',
    kind: 'in-place',
    scope: 'global',
    group: 'whole',
    // 6 instances, the lowest in the shortlist, and four separate instructions
    // pasted verbatim more than once. The strongest single case for a button.
    instruction: 'The work this spec describes is done. Freeze every open thread into a decision, '
      + 'restructure from chronology to logic, rewrite in declarative present tense, and cut what '
      + 'implementation has since made untrue.',
  }),

  // The two that answer an aside. They are not in any menu: they render as
  // buttons on the aside itself, because the thing they act on is the draft
  // rather than a block you point at. They split on whether the answer needs
  // judgement — Import does and goes to the agent as a comment like every other
  // action, Delete does not and the browser answers it.
  defineAction({
    id: 'import',
    label: '← Import into spec',
    icon: '↩',
    kind: 'in-place',
    scope: 'aside',
    // Deliberately general: what this content is, and so what folding it in
    // means, is a property of the action that produced the aside rather than of
    // Import. The resolved thread carries a `target` with that action's own
    // import guidance already looked up.
    instruction: 'Fold this aside into the section named in its `data-sf-aside`, never into '
      + 'whatever happens to sit above it, and delete the aside afterwards. Where the aside names '
      + 'a `data-sf-block`, that is the block the reader asked about and the content belongs '
      + 'beside it. How it folds in depends on what kind of content it is, and the originating '
      + "action says: read `target.guidance` on the thread. One rule holds over all of them: do "
      + 'not cut anything the draft does not carry forward. Replacing three paragraphs with a '
      + 'diagram that covers those three is right; replacing twelve with it loses nine. When the '
      + 'draft supersedes only part of what is there, only that part goes. Comment threads on the '
      + 'imported blocks travel with them, because they anchor to blocks rather than to the aside.',
  }),

  // The only aside action the browser answers by itself, and the second `direct`
  // entry in the registry after Copy link. Rejecting a draft is not work for an
  // agent: there is no judgement in it, nothing to place and nothing to word, so
  // a round trip through a comment bought a wait and a token bill for a delete.
  // It is `direct` rather than `in-place` because no instruction is ever read.
  defineAction({
    id: 'delete',
    label: 'Delete',
    icon: '✕',
    kind: 'direct',
    scope: 'aside',
    // No instruction, for the same reason Copy link has none: the browser calls
    // DELETE /api/spec/:id/aside/:asideId and the section goes, with its threads.
    // The endpoint refuses anything that is not an aside, so the guard lives
    // where the write happens rather than in prose an agent might skim.
  }),
];

/** The action with this id, or null. */
export function actionById(id) {
  if (typeof id !== 'string' || !id) return null;
  return ALL_ACTIONS.find((a) => a.id === id) || null;
}

/**
 * The actions as the browser needs them, for injection into `window.SPECFORGE`.
 *
 * The instruction is left behind on purpose. The client never reads it: the
 * comment carries the id, and the agent resolves that against this registry. So
 * sending the instructions would put several kilobytes of prose into every page
 * for nothing, and would let a client-side copy drift from the one the agent
 * runs.
 */
export function menuActions() {
  return ALL_ACTIONS.map((a) => ({
    id: a.id, label: a.label, icon: a.icon, kind: a.kind, scope: a.scope, group: a.group,
  }));
}

/**
 * The menu's headings, in the order they appear.
 *
 * Sent alongside the actions so the client renders the order and the wording
 * from here rather than holding its own copy, which is the same reason the
 * action list is injected instead of hardcoded.
 */
export function menuGroups() {
  return GROUPS.map((g) => ({ id: g.id, label: g.label }));
}

/**
 * The actions offered at a scope.
 *
 * A section is a bigger block, so both get the same list: every local action
 * reads sensibly on either, and the block/section split earned nothing over the
 * corpus. Scope here is which surface you right-clicked, not which tag.
 */
export function forScope(scope) {
  return ALL_ACTIONS.filter((a) => a.scope === scope);
}

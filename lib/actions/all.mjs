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

import { defineAction } from './index.mjs';

/**
 * Every action, in menu order: local first, then the spec-wide ones.
 *
 * Within a scope the order is by kind, and by how often it was asked inside a
 * kind. Grouping by kind first is what keeps the two entries that rewrite your
 * text from sitting between the six that only ever add a draft beside it.
 */
export const ALL_ACTIONS = [
  defineAction({
    id: 'explain_simply',
    label: 'Explain simply',
    icon: '💡',
    kind: 'aside',
    scope: 'local',
    // 24 instances, the most asked in the corpus.
    instruction: 'Rewrite this for a reader who does not have this codebase in their head. '
      + 'Define or replace every term of art at first use. Leave the original prose alone: a spec '
      + 'is a technical document and the precise wording is often the point, so the plain-language '
      + 'version sits under it rather than over it.',
  }),

  defineAction({
    id: 'visualize',
    label: 'Visualize',
    icon: '⊞',
    kind: 'aside',
    scope: 'local',
    // The one action whose output supersedes its input. A diagram of a section
    // is that section afterwards; keeping the prose beside it leaves the same
    // thing said twice, in two forms that then drift apart.
    importMode: 'replace',
    // 23 instances.
    instruction: 'Choose the form this content actually wants, a diagram, a table or a mock, and '
      + 'build it. Pick the form yourself rather than asking; that judgement is most of the value '
      + 'here. Every node and edge you draw must appear in the prose it came from.',
  }),

  defineAction({
    id: 'go_deeper',
    label: 'Go deeper',
    icon: '🔎',
    kind: 'aside',
    scope: 'local',
    // 22 instances, and the largest output of any action in the corpus.
    instruction: 'For each named thing here: what it is, why it exists, what it is for, and when '
      + 'it was added and by whom where that is knowable. Those four questions are nearly always '
      + 'what was meant, so answer them without being asked.',
  }),

  defineAction({
    id: 'verify_against_code',
    label: 'Verify against code',
    icon: '✓',
    kind: 'aside',
    scope: 'local',
    needsDetail: true,
    // 20 instances. Reports rather than corrects: a confident fix built on a
    // misreading turns a true claim into a false one, silently.
    instruction: 'Check the claims here against the tree and report what disagrees: the claim, '
      + 'what the code actually does, and the file and line it is in. Do not correct the spec. '
      + 'If the comment did not name which claim to check or where to look, say which claims you '
      + 'checked and ask, rather than guessing at the one that was meant.',
  }),

  defineAction({
    id: 'help_me_decide',
    label: 'Help me decide',
    icon: '⚖',
    kind: 'aside',
    scope: 'local',
    // 15 instances. Named for what the reader wants rather than what the spec
    // lacks.
    instruction: 'Give the reader everything the call needs: what is being decided, why it '
      + 'matters, what each option costs, what the risks are, and what happens either way. Plain '
      + 'words first, then the technical terms the choice turns on. Never leave it open ended: '
      + 'offer options with their consequences stated, so a one-word answer settles it.',
  }),

  defineAction({
    id: 'show_an_example',
    label: 'Show an example',
    icon: '❝',
    kind: 'aside',
    scope: 'local',
    // 13 instances. What gets reached for when explain simply was not enough.
    instruction: 'Build a worked example big enough to carry the concept, in code where the '
      + 'subject is code. Illustrative rather than normative: it shows how the thing behaves, it '
      + 'does not add a requirement.',
  }),

  defineAction({
    id: 'restructure',
    label: 'Restructure',
    icon: '☰',
    kind: 'in-place',
    scope: 'local',
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
    // 4 instances, the lowest local count. Earns its place on being a distinct
    // intent from deleting: nothing here is stale, there is just too much of it.
    instruction: 'Cover the same ground in fewer words. Cut the excessive detail and keep what the '
      + 'section is for. Nothing here is stale, so nothing should be dropped outright; this is '
      + 'compression, not deletion.',
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
    // 6 instances, the lowest in the shortlist, and four separate instructions
    // pasted verbatim more than once. The strongest single case for a button.
    instruction: 'The work this spec describes is done. Freeze every open thread into a decision, '
      + 'restructure from chronology to logic, rewrite in declarative present tense, and cut what '
      + 'implementation has since made untrue.',
  }),

  // The two that answer an aside. They are not in any menu: they render as
  // buttons on the aside itself, because the thing they act on is the draft
  // rather than a block you point at. Everything else about them is ordinary —
  // a click seeds the composer and you send a comment, same as the rest.
  defineAction({
    id: 'import',
    label: '← Import into spec',
    icon: '↩',
    kind: 'in-place',
    scope: 'aside',
    // Deliberately general: what this merges, where, and whether it replaces the
    // section are properties of the aside being answered, not of the action. The
    // resolved thread carries a `target` with the concrete version.
    instruction: 'Merge this aside into the section named in its `data-sf-aside`, never into '
      + 'whatever happens to sit above it, and delete the aside afterwards. Where the aside names '
      + 'a `data-sf-block`, that is the block the reader asked about and the content belongs '
      + "beside it. The originating action decides the form and whether the draft replaces the "
      + 'section or adds to it; read `target` on the thread rather than deciding yourself. Comment '
      + 'threads on the imported blocks travel with them, because they anchor to blocks rather '
      + 'than to the aside.',
  }),

  defineAction({
    id: 'dismiss',
    label: 'Dismiss',
    icon: '✕',
    kind: 'in-place',
    scope: 'aside',
    instruction: 'Delete this aside section and its comment threads. Same as deleting any section '
      + 'that has been commented on. Do not change the section it was attached to.',
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
    id: a.id, label: a.label, icon: a.icon, kind: a.kind, scope: a.scope,
  }));
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

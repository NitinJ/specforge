// The action registry: what an action is, and what an id is allowed to be.
//
// An action is a menu entry that writes a comment. Clicking Visualize on a
// section puts `@agent @visualize` in the comment box; you send it like any
// comment and the session attached to the spec picks it up. So the feature adds
// no channel between the browser and the agent, and the browser never writes the
// spec file.
//
// What the comment carries is the id, not the instruction. That keeps the body
// readable and lets an instruction be improved without rewriting comments
// already sent, which is why the two are separate fields here.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §9.

/**
 * Where the result of an action lands.
 *
 * `direct` is the browser doing something that changes no document text (Copy
 * link). `in-place` is the agent rewriting content that is already there.
 * `aside` is the agent writing content that is not there yet, into a section
 * placed directly under the source one.
 */
export const KINDS = ['direct', 'in-place', 'aside'];

/**
 * What an action runs on.
 *
 * `local` is a block or a section you point at, `global` is the whole spec, and
 * `aside` is a draft the agent already wrote: Import and Dismiss, which appear
 * on the aside itself rather than in any menu.
 */
export const SCOPES = ['local', 'global', 'aside'];

/**
 * The headings the menu groups its entries under, in order.
 *
 * By what the reader is trying to get, which is how §4 bucketed the corpus, and
 * not by what the action does to the document. The eight research buckets are
 * too fine for a menu of nine entries: `understand` merges Comprehension with
 * the "fill the gaps" half of Structure and with Presentation, `check` merges
 * Grounding with Decision, `change` holds Compression and the "reorganise" half
 * of Structure.
 *
 * One property survives the regrouping: every entry that rewrites your text is
 * under `change`, so the actions that edit a section never sit between the ones
 * that only draft beside it.
 *
 * `null` is for an action with no heading of its own. Copy link is the only one:
 * it is neither a request nor an edit, and a group of one reads as a mistake.
 */
export const GROUPS = [
  { id: 'understand', label: 'Understand it' },
  { id: 'check', label: 'Check it' },
  { id: 'change', label: 'Change it' },
  { id: 'whole', label: 'Whole spec' },
];
const GROUP_IDS = GROUPS.map((g) => g.id);

// An id travels inside a comment body as `@agent @<id>`, and the parser that
// reads it back stops the token at whitespace. Anything outside this shape is
// either unreadable there (a space, a comma) or reads back as a different string
// (a capital), so it is refused at load time where it is still a typo.
const ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Normalise an action record and fail loudly on a malformed one.
 *
 * @param {object} a
 * @returns {{id:string, label:string, icon:string, kind:string, scope:string,
 *            instruction:string, needsDetail:boolean, importInstruction:string}}
 */
export function defineAction(a) {
  if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id)) {
    throw new Error(
      `action: id must be a lowercase token with underscores, got ${JSON.stringify(a && a.id)}`,
    );
  }
  if (typeof a.label !== 'string' || !a.label.trim()) {
    throw new Error(`action ${a.id}: a label is required, it is what the menu shows`);
  }
  if (typeof a.icon !== 'string' || !a.icon.trim()) {
    throw new Error(`action ${a.id}: an icon is required, it is what the menu shows beside the label`);
  }
  if (!KINDS.includes(a.kind)) {
    throw new Error(`action ${a.id}: unknown kind ${JSON.stringify(a.kind)}, expected one of ${KINDS.join(', ')}`);
  }
  if (!SCOPES.includes(a.scope)) {
    throw new Error(`action ${a.id}: unknown scope ${JSON.stringify(a.scope)}, expected one of ${SCOPES.join(', ')}`);
  }
  const instruction = typeof a.instruction === 'string' ? a.instruction.trim() : '';
  // A direct action is the browser doing something; nobody reads an instruction
  // for it. Every other kind ends up in front of an agent with nothing else to
  // go on, so an empty one is a menu entry that does nothing.
  if (a.kind !== 'direct' && !instruction) {
    throw new Error(`action ${a.id}: an instruction is required for a ${a.kind} action`);
  }
  // Which heading it sits under. Required for anything that reaches a menu, so a
  // new action cannot be added and silently land in whichever group the renderer
  // happens to sweep it into. An aside-scope action is on the draft itself and
  // never in a menu, so it has no group to declare.
  const group = a.group === undefined ? null : a.group;
  if (group !== null && !GROUP_IDS.includes(group)) {
    throw new Error(`action ${a.id}: unknown group ${JSON.stringify(group)}, expected one of ${GROUP_IDS.join(', ')}`);
  }
  if (a.scope !== 'aside' && group === null && a.id !== 'copy_link') {
    throw new Error(`action ${a.id}: a group is required, it is the heading the menu shows this under`);
  }
  const importInstruction = typeof a.importInstruction === 'string' ? a.importInstruction.trim() : '';
  // Only an aside is ever imported, so guidance on anything else is a statement
  // about a thing that never happens, and reads as though it does.
  if (importInstruction && a.kind !== 'aside') {
    throw new Error(`action ${a.id}: importInstruction is only meaningful on an aside action, and this is ${a.kind}`);
  }
  // Required for the same reason `instruction` is. What to write and what to do
  // with it once the reader accepts it are two different standards, and only one
  // of them was ever written down: an aside imported with nothing to go on gets
  // placed wherever the agent felt like putting it.
  if (a.kind === 'aside' && !importInstruction) {
    throw new Error(`action ${a.id}: an importInstruction is required for an aside action, because its draft is imported`);
  }
  return {
    id: a.id,
    label: a.label.trim(),
    icon: a.icon.trim(),
    kind: a.kind,
    scope: a.scope,
    instruction,
    // True when the action cannot run on its instruction alone: the reader has
    // to type a fact only they hold into the comment before sending it.
    needsDetail: a.needsDetail === true,
    // How this action's own output is folded back into the spec. Empty on
    // everything that never produces an aside.
    importInstruction,
    // The menu heading this sits under, or null for the one entry that has none.
    group,
  };
}

/**
 * Ids that appear more than once.
 *
 * Two actions with one id means a comment saying `@agent @visualize` resolves to
 * whichever the lookup happens to find, so it is reported rather than resolved.
 */
export function duplicateActionIds(actions) {
  const seen = new Set();
  const dups = new Set();
  for (const a of actions) {
    if (seen.has(a.id)) dups.add(a.id);
    seen.add(a.id);
  }
  return [...dups];
}

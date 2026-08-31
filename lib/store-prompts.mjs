// User customizations of the prompt text SpecForge hands agents.
//
// Store-wide settings only: the language preamble, and everything about actions
// (text overrides, menu visibility, user-created actions). Per-type prompts and
// rules are NOT here — they live in each type's template spec, where they
// already did before this feature, because two homes for one override means a
// precedence rule nobody remembers (spec 094abd0b9d, D2).
//
// Absent until something is customized. That is the state every store ships in,
// so a missing file is the normal case rather than an error, and a malformed one
// reads as empty rather than throwing: a settings file must never be able to
// stop the daemon serving.
//
// Spec 094abd0b9d §6.

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { promptsPath, storeRoot } from './store-paths.mjs';

/** The classes a reset operates on (P6). Sections and Rules reset elsewhere. */
export const PROMPT_CLASSES = ['language', 'actions'];

/**
 * How long an instruction may be.
 *
 * The longest shipped instruction is 664 characters. 4,000 leaves room to write
 * a considerably more demanding one without letting a paste of a whole document
 * become the thing every agent reads on every action.
 */
export const MAX_INSTRUCTION = 4000;

/**
 * And the preamble, which is prepended to agent work rather than per-action.
 *
 * Sized to hold the shipped contract and then some. 4,000 was set when the box
 * held a short direction added on top of the contract; the box now opens with
 * the contract itself in it, which is 3,329 characters, and a cap that leaves
 * 671 to edit within is a cap that makes the feature useless.
 */
export const MAX_LANGUAGE = 12000;

/**
 * The prefix every user-created action id carries.
 *
 * It partitions the namespace permanently: a shipped action can never be added
 * with an id that collides with an existing custom one, and a custom id can
 * never shadow a shipped one. Without it, an upgrade that adds `glossary` would
 * silently change what a user's `@glossary` comments resolve to (D12).
 */
export const CUSTOM_PREFIX = 'x_';

/** A custom id: the shipped grammar, behind the reserved prefix. */
const CUSTOM_ID_RE = /^x_[a-z][a-z0-9_]*$/;

/**
 * What an aside action's Import does when its author did not say.
 *
 * The registry requires an importInstruction on every aside action, because a
 * draft nobody knows how to place is a draft that cannot be accepted. Each
 * shipped action words its own; demanding the same of a user means writing two
 * instructions to create one action, and the second is the one whose purpose is
 * least obvious at creation time. So a custom aside gets this until its author
 * replaces it, which the Actions tab offers as an editable field.
 */
export const DEFAULT_IMPORT_INSTRUCTION = 'Put this draft into the section it was written for, '
  + 'and take out whatever it supersedes. Judge that by reading it against the section: what the '
  + 'draft now says better comes out, and anything it does not cover stays exactly as it is.';

/** Only text is overridable. Identity fields of a shipped action are fixed (D3). */
const OVERRIDE_KEYS = ['instruction', 'importInstruction'];

/**
 * What a user-created action may be.
 *
 * A subset of the registry's own lists on purpose. `direct` is the browser doing
 * something the browser has code for, so a user cannot declare one; `aside`
 * scope belongs to Import and Dismiss, which appear on a draft rather than in
 * any menu and are not things to create.
 */
export const CUSTOM_KINDS = ['aside', 'in-place'];
export const CUSTOM_SCOPES = ['local', 'global'];

function str(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Coerce a raw override record to the two text keys, dropping empties. */
function sanitizeOverride(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of OVERRIDE_KEYS) {
    const v = str(raw[k], MAX_INSTRUCTION);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Coerce a raw custom-action record.
 *
 * Validated here rather than at merge time so a malformed entry is dropped once,
 * on read, instead of throwing from inside whichever consumer touched it first.
 * `defineAction` validates the same shape again when the entry is merged; this
 * is the gate that keeps a bad file from reaching it.
 */
function sanitizeCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !CUSTOM_ID_RE.test(raw.id)) return null;
  const label = str(raw.label, 60);
  const instruction = str(raw.instruction, MAX_INSTRUCTION);
  if (!label || !instruction) return null;
  // Enums are validated, never coerced. Falling back on an unrecognised value
  // would turn `kind: "inplace"` into an aside and `scope: "globl"` into a local
  // action: a typo would silently change what the action does rather than being
  // reported, and the author would be left debugging an action that works but
  // wrongly. Refusing the entry is the same answer a bad id gets.
  const kind = raw.kind === undefined ? 'aside' : raw.kind;
  const scope = raw.scope === undefined ? 'local' : raw.scope;
  if (!CUSTOM_KINDS.includes(kind) || !CUSTOM_SCOPES.includes(scope)) return null;
  const out = {
    id: raw.id,
    label,
    icon: str(raw.icon, 8) || '✦',
    kind,
    scope,
    instruction,
  };
  const group = str(raw.group, 24);
  if (group) out.group = group;
  const imp = str(raw.importInstruction, MAX_INSTRUCTION);
  // An aside always carries one, its author's or the default; an in-place action
  // has no draft to import and gets one only if it was given one.
  if (imp) out.importInstruction = imp;
  else if (out.kind === 'aside') out.importInstruction = DEFAULT_IMPORT_INSTRUCTION;
  return out;
}

/** Coerce a raw prompts file to the known shape, dropping everything else. */
export function sanitizePrompts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;

  const language = str(raw.language, MAX_LANGUAGE);
  if (language) out.language = language;

  const a = raw.actions;
  if (!a || typeof a !== 'object') return out;
  const actions = {};

  const hidden = Array.isArray(a.hidden)
    ? [...new Set(a.hidden.filter((id) => typeof id === 'string' && id))]
    : [];
  if (hidden.length) actions.hidden = hidden;

  if (a.overrides && typeof a.overrides === 'object') {
    const overrides = {};
    for (const [id, rec] of Object.entries(a.overrides)) {
      const clean = sanitizeOverride(rec);
      if (clean) overrides[id] = clean;
    }
    if (Object.keys(overrides).length) actions.overrides = overrides;
  }

  if (Array.isArray(a.custom)) {
    const seen = new Set();
    const custom = [];
    for (const rec of a.custom) {
      const clean = sanitizeCustom(rec);
      // First definition wins on a duplicate id: later ones would silently
      // replace an action a comment may already reference.
      if (clean && !seen.has(clean.id)) {
        seen.add(clean.id);
        custom.push(clean);
      }
    }
    if (custom.length) actions.custom = custom;
  }

  // Tombstones: ids of deleted custom actions, with the instruction they last
  // carried. A comment naming a deleted action must still resolve (D3, D12), so
  // deletion moves the record here rather than dropping it.
  if (Array.isArray(a.tombstones)) {
    const tombstones = [];
    for (const rec of a.tombstones) {
      const clean = sanitizeCustom(rec);
      if (clean) tombstones.push(clean);
    }
    if (tombstones.length) actions.tombstones = tombstones;
  }

  if (Object.keys(actions).length) out.actions = actions;
  return out;
}

/** Read the store's customizations, or {} when there are none. */
export function readPrompts() {
  try {
    return sanitizePrompts(JSON.parse(readFileSync(promptsPath(), 'utf8')));
  } catch {
    return {};
  }
}

/**
 * Merge a patch into the stored customizations and persist; returns the merged
 * result. `actions` merges one level down, so a patch touching only `hidden`
 * leaves overrides and custom actions alone.
 *
 * **Clearing is explicit: pass `null`.** A patch omitting a key leaves it alone,
 * which is what makes a partial save from one tab safe. That means an empty
 * string cannot clear anything, because sanitize drops empties and the merge
 * then keeps the old value: `{ language: '' }` would look like a clear and
 * silently be a no-op. `{ language: null }` removes the key, and inside
 * `actions` a null removes that sub-key. This is the per-entry reset (P3), which
 * the settings page needs and which resetPromptClass is too blunt for.
 */
export function writePrompts(patch) {
  const current = readPrompts();
  const clean = sanitizePrompts(patch);
  const raw = patch && typeof patch === 'object' ? patch : {};

  const next = { ...current, ...clean };
  if (raw.language === null) delete next.language;

  const rawActions = raw.actions && typeof raw.actions === 'object' ? raw.actions : null;
  if (clean.actions || rawActions) {
    const merged = { ...(current.actions || {}), ...(clean.actions || {}) };
    if (rawActions) {
      for (const [k, v] of Object.entries(rawActions)) {
        if (v === null) delete merged[k];
      }
    }
    if (Object.keys(merged).length) next.actions = merged;
    else delete next.actions;
  }

  const out = sanitizePrompts(next);
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(promptsPath(), JSON.stringify(out, null, 2));
  return out;
}

/**
 * Reset one class to its shipped values (P6).
 *
 * Deleting the class's keys is the whole operation: with nothing stored, the
 * shipped defaults apply alone, which is the state the product ships in.
 * Removing the last class removes the file, so an untouched store and a
 * fully-reset one are the same thing on disk.
 *
 * Tombstones survive a reset: an id a comment already names has to keep
 * resolving whatever the user does to their settings.
 */
export function resetPromptClass(cls) {
  if (!PROMPT_CLASSES.includes(cls)) {
    throw new Error(`reset: unknown class ${JSON.stringify(cls)}, expected one of ${PROMPT_CLASSES.join(', ')}`);
  }
  const current = readPrompts();
  const next = { ...current };
  if (cls === 'language') delete next.language;
  if (cls === 'actions') {
    const keep = current.actions && current.actions.tombstones;
    if (keep) next.actions = { tombstones: keep };
    else delete next.actions;
  }
  const merged = sanitizePrompts(next);
  if (!Object.keys(merged).length) {
    if (existsSync(promptsPath())) rmSync(promptsPath(), { force: true });
    return {};
  }
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(promptsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * Delete a custom action, keeping a tombstone so its id still resolves.
 *
 * @param {string} id a custom action id
 * @returns {object} the merged prompts
 */
export function deleteCustomAction(id) {
  const current = readPrompts();
  const actions = current.actions || {};
  const custom = actions.custom || [];
  const gone = custom.find((a) => a.id === id);
  if (!gone) return current;
  const tombstones = [...(actions.tombstones || []).filter((t) => t.id !== id), gone];
  const next = {
    ...current,
    actions: { ...actions, custom: custom.filter((a) => a.id !== id), tombstones },
  };
  const merged = sanitizePrompts(next);
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(promptsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

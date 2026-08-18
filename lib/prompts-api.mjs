// What the settings page reads and writes.
//
// The page needs more than the stored file: it renders the effective text
// beside a marker saying whether it is the user's or the shipped default (P5),
// and a reset has to restore something, so the shipped values travel with the
// customizations rather than being hardcoded in the page.
//
// Kept out of the daemon so it can be tested without a server, the same split
// store-api.mjs already uses.
//
// Spec 094abd0b9d §6.

import {
  readPrompts, writePrompts, resetPromptClass, deleteCustomAction,
} from './store-prompts.mjs';
import { SHIPPED_ACTIONS, allActions } from './actions/all.mjs';
import { GROUPS } from './actions/index.mjs';

/**
 * The state of every customizable surface, effective values and defaults both.
 *
 * @returns {{
 *   language: {value: string, customized: boolean},
 *   actions: {shipped: object[], custom: object[], groups: object[]},
 * }}
 */
export function handlePromptsGet() {
  const stored = readPrompts();
  const cfg = stored.actions || {};
  const hidden = new Set(cfg.hidden || []);
  const overrides = cfg.overrides || {};
  const effective = allActions();

  const shipped = SHIPPED_ACTIONS.map((a) => {
    const live = effective.find((e) => e.id === a.id) || a;
    const o = overrides[a.id] || {};
    return {
      id: a.id,
      label: a.label,
      icon: a.icon,
      kind: a.kind,
      scope: a.scope,
      group: a.group,
      hidden: hidden.has(a.id),
      // Both, because the page shows what is in force and a reset has to know
      // what to put back.
      instruction: live.instruction || '',
      shippedInstruction: a.instruction || '',
      importInstruction: live.importInstruction || '',
      shippedImportInstruction: a.importInstruction || '',
      customized: Boolean(o.instruction || o.importInstruction),
    };
  });

  const custom = (cfg.custom || []).map((a) => ({ ...a, hidden: hidden.has(a.id) }));

  return {
    language: { value: stored.language || '', customized: Boolean(stored.language) },
    actions: { shipped, custom, groups: GROUPS.map((g) => ({ id: g.id, label: g.label })) },
  };
}

/**
 * Apply a change and answer with the state the page should now show.
 *
 * Two operations ride alongside the plain patch because neither is expressible
 * as one: deleting a custom action has to leave a tombstone so its id keeps
 * resolving, and clearing one shipped action's override has to leave the other
 * overrides alone, which a whole-map patch cannot say.
 */
export function handlePromptsPut(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};

  if (typeof p.deleteCustom === 'string' && p.deleteCustom) {
    deleteCustomAction(p.deleteCustom);
    return handlePromptsGet();
  }

  if (typeof p.resetOverride === 'string' && p.resetOverride) {
    const overrides = { ...((readPrompts().actions || {}).overrides || {}) };
    delete overrides[p.resetOverride];
    writePrompts({ actions: { overrides: Object.keys(overrides).length ? overrides : null } });
    return handlePromptsGet();
  }

  writePrompts(p);
  return handlePromptsGet();
}

/** Reset one class and answer with the state the page should now show. */
export function handlePromptsReset(cls) {
  resetPromptClass(cls);
  return handlePromptsGet();
}

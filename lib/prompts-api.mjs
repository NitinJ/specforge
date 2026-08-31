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
  readPrompts, writePrompts, resetPromptClass, deleteCustomAction, MAX_LANGUAGE,
} from './store-prompts.mjs';
import { shippedLanguageContract, languageContract } from './language-contract.mjs';
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
    language: {
      // What is actually in force, which is what the box edits. A store that
      // has never been touched gets the shipped contract; one carrying a short
      // direction from before the box held the contract gets the shipped rules
      // with that direction appended, so opening the tab neither hides the
      // rules nor loses the direction.
      value: languageContract(),
      customized: Boolean(stored.language),
      // Travels as the reset target, and as what an edit is compared against.
      contract: shippedLanguageContract(),
      max: MAX_LANGUAGE,
    },
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

  // One action's override, merged into the others rather than replacing them.
  // A plain patch cannot say this: writePrompts merges `actions` one level down,
  // so sending `{overrides: {visualize: …}}` would drop every other override.
  // Raised in review of PR #204.
  if (p.setOverride && typeof p.setOverride === 'object' && p.setOverride.id) {
    const { id, ...text } = p.setOverride;
    const overrides = { ...((readPrompts().actions || {}).overrides || {}) };
    const keep = {};
    for (const k of ['instruction', 'importInstruction']) {
      if (typeof text[k] === 'string' && text[k].trim()) keep[k] = text[k];
    }
    if (Object.keys(keep).length) overrides[id] = keep;
    else delete overrides[id]; // emptied every field: that is a reset
    writePrompts({ actions: { overrides: Object.keys(overrides).length ? overrides : null } });
    return handlePromptsGet();
  }

  if (typeof p.resetOverride === 'string' && p.resetOverride) {
    const overrides = { ...((readPrompts().actions || {}).overrides || {}) };
    delete overrides[p.resetOverride];
    writePrompts({ actions: { overrides: Object.keys(overrides).length ? overrides : null } });
    return handlePromptsGet();
  }

  if (typeof p.language === 'string') {
    // Saving the contract back unchanged is not a customization. Without this,
    // opening the tab and pressing Save would freeze a copy of the shipped text
    // that stops tracking it, and the page would say "customized" about a
    // document identical to the default.
    if (p.language.trim() === shippedLanguageContract().trim()) {
      writePrompts({ ...p, language: null });
      return handlePromptsGet();
    }
    // Same rule for a store customized before the tab held the contract. Its box
    // opens on the shipped rules with that store's own direction appended, and
    // that composed text is what an unchanged Save sends back. Measured against
    // the shipped text alone it looks edited, so the save would convert a store
    // that still tracks shipped updates into a frozen fork of them, without the
    // person pressing Save having changed a character.
    if (p.language.trim() === languageContract().trim()) {
      const { language, ...rest } = p;
      writePrompts(rest);
      return handlePromptsGet();
    }
    // Anything else saved from here is the whole contract, and is stamped as
    // such: a store carrying a pre-tab direction has to keep being read as an
    // addition to the shipped rules until its owner saves over it.
    writePrompts({ ...p, languageMode: 'contract' });
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

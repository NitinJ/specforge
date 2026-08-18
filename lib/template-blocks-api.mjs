// What the Sections and Rules tabs read and write.
//
// These two classes live in the template specs, not in prompts.json, because
// they are per type and that is where they already lived before this feature
// (spec 094abd0b9d, D2). The pane is a better editor over the same data rather
// than a rival store, so everything here goes through store-templates.
//
// The shape mirrors prompts-api: effective values with the shipped ones beside
// them, because a reset has to restore something and a page that held its own
// copy of the defaults would drift the first time one was improved.

import { SPEC_TYPES } from './meta.mjs';
import {
  templateRules, templatePrompts, templateOutline, updateTemplateBlocks, resetTemplateBlocks,
} from './store-templates.mjs';
import { TEMPLATE_RULES, TEMPLATE_PROMPTS } from './rules/template-defaults.mjs';

/** The ids a user may not reuse: everything the plugin ships for this type. */
function shippedRuleIds(type) {
  return new Set((TEMPLATE_RULES[type] || []).map((r) => r.id));
}

/**
 * The state of one type's blocks.
 *
 * @param {string} type
 */
export function handleTemplateBlocksGet(type) {
  if (!SPEC_TYPES.includes(type)) throw new Error(`unknown type ${JSON.stringify(type)}`);
  const shippedIds = shippedRuleIds(type);
  const rules = templateRules(type).map((r) => ({
    ...r,
    shipped: shippedIds.has(r.id),
  }));
  const prompts = templatePrompts(type);
  const shippedPromptIds = new Set(Object.keys(TEMPLATE_PROMPTS));
  // Compared with whitespace collapsed. A prompt is rendered into the template
  // as one <p> per paragraph and parsed back as joined text, so a shipped prompt
  // never byte-matches the constant it came from and every row would read as
  // customized. Found by looking at the rendered tab.
  const same = (a, b) => String(a).replace(/\s+/g, ' ').trim()
    === String(b).replace(/\s+/g, ' ').trim();

  // Every section, whether or not it carries guidance, because the tab is where
  // guidance is added and a list of what exists cannot be added to. `canHold` is
  // false for a section with no id: renderTemplateBlocks targets a section by id,
  // so a prompt for an unnamed one has nowhere to go.
  const byId = new Map(prompts.map((p) => [p.section, p.text]));
  const sections = templateOutline(type).map((s) => ({
    id: s.id,
    heading: s.heading,
    level: s.level,
    subheadings: s.subheadings,
    canHold: Boolean(s.id),
    hasPrompt: Boolean(s.id && byId.has(s.id)),
  }));

  return {
    type,
    types: SPEC_TYPES,
    rules,
    sections,
    prompts: prompts.map((p) => ({
      ...p,
      shipped: shippedPromptIds.has(p.section),
      customized: !shippedPromptIds.has(p.section)
        || !same(p.text, TEMPLATE_PROMPTS[p.section]),
    })),
    shipped: {
      rules: TEMPLATE_RULES[type] || [],
      prompts: Object.entries(TEMPLATE_PROMPTS).map(([section, text]) => ({ section, text })),
    },
  };
}

/**
 * Write one type's blocks and answer with the state the page should now show.
 *
 * Shipped rules are not editable and not removable (D9): the pane adds custom
 * rules only, and the floor under every spec is the product's opinion. So the
 * shipped set is re-attached to whatever the page sent rather than trusted from
 * it, which means a page bug cannot quietly delete a rule.
 */
export function handleTemplateBlocksPut(type, body) {
  if (!SPEC_TYPES.includes(type)) throw new Error(`unknown type ${JSON.stringify(type)}`);
  const b = body && typeof body === 'object' ? body : {};
  const shippedIds = shippedRuleIds(type);

  const custom = (Array.isArray(b.rules) ? b.rules : [])
    .filter((r) => r && typeof r.id === 'string' && !shippedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      ask: typeof r.ask === 'string' ? r.ask.trim() : '',
      fix: typeof r.fix === 'string' ? r.fix.trim() : '',
      ...(r.severity === 'advisory' ? { severity: 'advisory' } : {}),
    }))
    .filter((r) => r.ask);

  const prompts = {};
  for (const p of Array.isArray(b.prompts) ? b.prompts : []) {
    if (!p || typeof p.section !== 'string' || !p.section) continue;
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (text) prompts[p.section] = text;
  }

  updateTemplateBlocks(type, { rules: [...(TEMPLATE_RULES[type] || []), ...custom], prompts });
  return handleTemplateBlocksGet(type);
}

/** The two classes stored in a template. A reset names one, or all of them. */
export const TEMPLATE_CLASSES = ['sections', 'rules'];

/**
 * Reset one type's blocks to what the plugin ships (P6).
 *
 * Scoped to a class, because the two live in one file but are two tabs and the
 * confirm names only the one you are on. Resetting Rules used to take the
 * type's section prompts with it, which the user was never told (raised in
 * review of PR #207). With no class named, both go, which is what the whole
 * type being reset means.
 *
 * @param {string} type
 * @param {'sections'|'rules'} [cls] the class to reset; omit for both
 */
export function handleTemplateBlocksReset(type, cls) {
  if (!SPEC_TYPES.includes(type)) throw new Error(`unknown type ${JSON.stringify(type)}`);
  if (cls === undefined || cls === null || cls === '') {
    resetTemplateBlocks(type);
    return handleTemplateBlocksGet(type);
  }
  if (!TEMPLATE_CLASSES.includes(cls)) throw new Error(`unknown class ${JSON.stringify(cls)}`);

  const shippedIds = shippedRuleIds(type);
  // Whichever class is not being reset is read back out and written again
  // unchanged. The write is whole-file either way, so keeping a class means
  // carrying it through rather than leaving it alone.
  const keptRules = cls === 'sections'
    ? templateRules(type).filter((r) => !shippedIds.has(r.id))
    : [];
  const keptPrompts = cls === 'rules'
    ? Object.fromEntries(templatePrompts(type).map((p) => [p.section, p.text]))
    : TEMPLATE_PROMPTS;

  updateTemplateBlocks(type, {
    rules: [...(TEMPLATE_RULES[type] || []), ...keptRules],
    prompts: keptPrompts,
  });
  return handleTemplateBlocksGet(type);
}

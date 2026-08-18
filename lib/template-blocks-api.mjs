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
  templateRules, templatePrompts, updateTemplateBlocks, resetTemplateBlocks,
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

  return {
    type,
    types: SPEC_TYPES,
    rules,
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

/** Reset one type's blocks to what the plugin ships (P6). */
export function handleTemplateBlocksReset(type) {
  if (!SPEC_TYPES.includes(type)) throw new Error(`unknown type ${JSON.stringify(type)}`);
  resetTemplateBlocks(type);
  return handleTemplateBlocksGet(type);
}

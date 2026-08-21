// Template specs — the per-type spec templates, stored (and editable) as specs.
//
// One protected spec per spec type lives in the store under a fixed id
// (`template-<type>`). Its spec.html IS the template: `create`/`convert`
// scaffold from it, so editing the template spec through the normal SpecForge
// flow (browser review → agent edits, live reload) edits what every future
// spec starts from. The bundled shells in templates/ remain the seed + the
// fallback when a store template is missing or emptied.
//
// meta.template = true marks them protected: the index renders them as
// templates (no lifecycle controls) and any future destructive surface must
// refuse them. They are intentionally attachable — that is how they're edited.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defaultMeta, readMeta, writeMeta } from './meta.mjs';
import { specTypes, specType, isSpecType, templateIdFor } from './spec-types.mjs';
import { specDir, specHtmlPath } from './store-paths.mjs';
import { TEMPLATE_RULES, TEMPLATE_PROMPTS } from './rules/template-defaults.mjs';
import {
  parseTemplateRules,
  parseTemplatePrompts,
  parseTemplateOutline,
  renderTemplateBlocks,
  stripTemplateBlocks,
} from './rules/template-blocks.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_FILE = {
  doc: join(REPO, 'templates', 'spec-base-doc.html'),
  impl: join(REPO, 'templates', 'spec-base.html'),
};

/** The collection template specs are grouped under on the index. */
export const TEMPLATE_COLLECTION = 'Templates';

/** Fixed, human-readable store id for a type's template spec. */
export const templateId = templateIdFor;

/**
 * The bundled shell HTML for a type (the seed + fallback). A per-type file
 * `templates/spec-base-<type>.html` wins when present (e.g. research has its own
 * shell, not the shared doc shell); otherwise the type falls back to the shell
 * family its registry row names (doc / impl).
 *
 * A custom kind never has a per-type file, so it always takes the family branch.
 * An unknown kind takes `impl`, which is what this did before kinds could be
 * unknown: the fuller shell, on the grounds that a missing section is easier to
 * notice than a missing plan.
 */
function bundledShell(type) {
  const perType = join(REPO, 'templates', `spec-base-${type}.html`);
  const family = (specType(type) || {}).shell;
  const shell = existsSync(perType)
    ? readFileSync(perType, 'utf8')
    : readFileSync(SHELL_FILE[family] || SHELL_FILE.impl, 'utf8');
  // The rules block and the prompts are rendered in per type rather than written
  // into the shell files, because `design-impl` and `impl` scaffold from the same
  // shell and their rule lists differ. One file cannot carry two blocks, and
  // duplicating a 500-line shell to hold four lines of rules means every future
  // shell edit is made twice.
  return renderTemplateBlocks(shell, {
    rules: TEMPLATE_RULES[type] || [],
    prompts: TEMPLATE_PROMPTS,
  });
}

/**
 * Seed one template spec per type into the store. Idempotent: an existing
 * template (edited or not) is never touched, so edits always survive a reseed.
 */
export function ensureTemplates() {
  for (const type of specTypes()) {
    const id = templateId(type);
    if (readMeta(id)) continue;
    mkdirSync(specDir(id), { recursive: true });
    if (!existsSync(specHtmlPath(id))) writeFileSync(specHtmlPath(id), bundledShell(type));
    writeMeta(id, {
      ...defaultMeta({ id, title: `Template · ${type}`, type }),
      template: true,
      collection: TEMPLATE_COLLECTION,
    });
  }
}

/**
 * The template HTML new specs of `type` scaffold from: the store template when
 * present and non-blank, else the bundled shell (a missing or emptied template
 * must never produce an empty spec).
 */
export function templateHtmlFor(type) {
  const id = templateId(type);
  if (readMeta(id)) {
    try {
      const html = readFileSync(specHtmlPath(id), 'utf8');
      if (html.trim()) return html;
    } catch {
      /* fall through to the bundled shell */
    }
  }
  return bundledShell(type);
}

/**
 * A type's own rules, as raw overrides for `mergeRules`.
 *
 * Read from the store template when there is one, so editing `template-design`
 * in SpecForge changes what a design spec is judged against. A template with no
 * block returns [], which is the state every template was in before this
 * feature: the global list applies alone and the feature degrades to exactly the
 * old behaviour.
 */
export function templateRules(type) {
  return parseTemplateRules(templateHtmlFor(type));
}

/**
 * A type's section prompts, as {section, text}.
 *
 * Handed to the authoring agent by `create` and stripped from the spec, so the
 * guidance arrives before the section is written and the file arrives clean.
 */
export function templatePrompts(type) {
  return parseTemplatePrompts(templateHtmlFor(type));
}

/**
 * A type's section outline, which is every place a prompt could go.
 *
 * `templatePrompts` says what guidance exists; this says where guidance can be
 * put. The configuration pane needs both to render a list you can add to.
 */
export function templateOutline(type) {
  return parseTemplateOutline(templateHtmlFor(type));
}

/**
 * Replace a template's rules and prompts blocks, leaving everything else alone.
 *
 * Strip then render, rather than editing in place: the two functions already
 * define where a block goes and what it looks like, so a third definition here
 * would be the one that drifts. The template's own content is untouched by
 * both, which is the property the settings page depends on — the pane owns
 * these blocks, and the shell belongs to whoever is editing the template as a
 * spec.
 *
 * Writing empty lists is how the pane resets a type: with no blocks the
 * shipped defaults apply alone, which is what an unseeded store does.
 *
 * @param {string} type a spec type
 * @param {{rules?:object[], prompts?:Record<string,string>}} blocks
 * @returns {{type:string, rules:number, prompts:number}}
 */
export function updateTemplateBlocks(type, { rules = [], prompts = {} } = {}) {
  if (!isSpecType(type)) {
    throw new Error(`template: unknown type ${JSON.stringify(type)}`);
  }
  ensureTemplates();
  const id = templateId(type);
  const bare = stripTemplateBlocks(readFileSync(specHtmlPath(id), 'utf8'));
  writeFileSync(specHtmlPath(id), renderTemplateBlocks(bare, { rules, prompts }));
  return { type, rules: rules.length, prompts: Object.keys(prompts).length };
}

/** Reset a type's blocks to what the plugin ships for it (P6). */
export function resetTemplateBlocks(type) {
  return updateTemplateBlocks(type, {
    rules: TEMPLATE_RULES[type] || [],
    prompts: TEMPLATE_PROMPTS,
  });
}

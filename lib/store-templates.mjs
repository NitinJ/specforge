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
import { SPEC_TYPES, TYPE_SHELL, defaultMeta, readMeta, writeMeta } from './meta.mjs';
import { specDir, specHtmlPath } from './store-paths.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_FILE = {
  doc: join(REPO, 'templates', 'spec-base-doc.html'),
  impl: join(REPO, 'templates', 'spec-base.html'),
};

/** The collection template specs are grouped under on the index. */
export const TEMPLATE_COLLECTION = 'Templates';

/** Fixed, human-readable store id for a type's template spec. */
export function templateId(type) {
  return `template-${type}`;
}

/**
 * The bundled shell HTML for a type (the seed + fallback). A per-type file
 * `templates/spec-base-<type>.html` wins when present (e.g. research has its own
 * shell, not the shared doc shell); otherwise the type falls back to its
 * TYPE_SHELL family (doc / impl).
 */
function bundledShell(type) {
  const perType = join(REPO, 'templates', `spec-base-${type}.html`);
  if (existsSync(perType)) return readFileSync(perType, 'utf8');
  return readFileSync(SHELL_FILE[TYPE_SHELL[type]] || SHELL_FILE.impl, 'utf8');
}

/**
 * Seed one template spec per type into the store. Idempotent: an existing
 * template (edited or not) is never touched, so edits always survive a reseed.
 */
export function ensureTemplates() {
  for (const type of SPEC_TYPES) {
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

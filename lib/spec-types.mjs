// What kinds of spec exist. The one place anything asks.
//
// A kind (called `type` on a spec's meta) decides which template a new spec
// scaffolds from and which rules it is judged against. Six ship with the plugin;
// the rest are added by the user and live in <STORE_ROOT>/types.json. Everything
// downstream treats the two identically, and the only difference is where the
// definition is read from.
//
// This module reads the filesystem and nothing else. That is deliberate:
// lib/meta.mjs validates a spec's kind and therefore has to import this, so this
// must not import lib/meta.mjs back. Deriving the kind list from the template
// specs already in the store would have been one artifact instead of two, and it
// is exactly that cycle which rules it out (spec 45395008a2, D2).
//
// Spec 45395008a2, task 1.1.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { storeRoot, typesPath, RESERVED_IDS } from './store-paths.mjs';

/**
 * The kinds that ship with the plugin, and the shell each scaffolds from.
 *
 * 'impl' is the full Stages/Tasks + live tracker + Runtime shell; 'doc' is the
 * chrome-only shell. Moved here from lib/meta.mjs, where it was the source of
 * the kind list as well as the shell map; it is now only the second of those.
 */
export const BUILTIN_SHELL = {
  general: 'doc',
  design: 'doc',
  research: 'doc',
  deck: 'doc',
  'design-impl': 'impl',
  impl: 'impl',
};

/** The two shell families a kind may scaffold from. */
export const SHELLS = ['doc', 'impl'];

/** Longest slug kept. Past this a slug stops being addressable at a glance. */
export const MAX_SLUG = 32;

/** Shortest slug kept. One character is a typo, not a name. */
export const MIN_SLUG = 2;

const MAX_LABEL = 60;
const MAX_WHEN = 400;

/** Fixed store id for a kind's template spec. */
export function templateIdFor(slug) {
  return `template-${slug}`;
}

/**
 * Turn a display name into a slug, or '' if it cannot be one.
 *
 * Everything outside [a-z0-9] collapses to a single hyphen, which is what makes
 * "RFC / ADR" and "Design—Impl" land somewhere a person would predict.
 */
export function slugify(name) {
  const slug = String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    // Trailing hyphen again: the slice above can leave one.
    .replace(/-+$/, '');
  return slug.length >= MIN_SLUG ? slug : '';
}

const SLUG_RE = new RegExp(`^[a-z0-9-]{${MIN_SLUG},${MAX_SLUG}}$`);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** One stored row, or null if it is not usable as a kind. */
function sanitizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  // A malformed slug is dropped rather than repaired: the slug is this row's
  // identity and a template spec is already named after it, so a repaired slug
  // would point at nothing.
  if (!SLUG_RE.test(slug)) return null;
  // An unknown shell costs the plainer scaffold, not the whole kind: the shell
  // is a property of the row, not its identity.
  const shell = SHELLS.includes(raw.shell) ? raw.shell : 'doc';
  return {
    slug,
    label: clean(raw.label, MAX_LABEL) || slug,
    shell,
    whenToUse: clean(raw.whenToUse, MAX_WHEN),
    created: Number(raw.created) || 0,
    builtin: false,
  };
}

/**
 * The custom kinds, in creation order.
 *
 * A missing or unparseable file reads as none, the same rule readGlobalPrefs and
 * loadStore already use: a broken store file must not take the daemon down, and
 * a store that predates this feature needs no migration.
 */
export function customTypes() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(typesPath(), 'utf8'));
  } catch {
    return [];
  }
  if (!raw || !Array.isArray(raw.custom)) return [];
  const out = [];
  const seen = new Set(Object.keys(BUILTIN_SHELL));
  for (const row of raw.custom) {
    const kind = sanitizeRow(row);
    // A row shadowing a built-in, or a duplicate of an earlier row, is dropped:
    // two definitions for one slug would give one template spec two owners (I1).
    if (!kind || seen.has(kind.slug)) continue;
    seen.add(kind.slug);
    out.push(kind);
  }
  return out;
}

/** One kind's full record, or null. */
export function specType(slug) {
  if (typeof slug !== 'string') return null;
  if (Object.hasOwn(BUILTIN_SHELL, slug)) {
    return {
      slug,
      label: slug,
      shell: BUILTIN_SHELL[slug],
      whenToUse: '',
      created: 0,
      builtin: true,
    };
  }
  return customTypes().find((t) => t.slug === slug) || null;
}

/** Every kind's slug: the built-ins in their own order, then customs in theirs. */
export function specTypes() {
  return [...Object.keys(BUILTIN_SHELL), ...customTypes().map((t) => t.slug)];
}

/** Whether `slug` names a kind. */
export function isSpecType(slug) {
  return specType(slug) !== null;
}

/**
 * Add a custom kind and return it.
 *
 * Validates before it writes, so a refused add leaves the file byte-identical
 * (I3). The caller still has to create the template spec; this owns the row.
 *
 * @param {{name:string, whenToUse?:string, shell?:'doc'|'impl'}} input
 * @returns {{slug, label, shell, whenToUse, created, builtin, templateId}}
 */
export function addCustomType({ name, whenToUse = '', shell = 'doc' } = {}) {
  const slug = slugify(name);
  if (!slug) {
    throw new Error(`name ${JSON.stringify(String(name ?? ''))} does not make a usable slug`);
  }
  if (!SHELLS.includes(shell)) {
    throw new Error(`shell must be one of: ${SHELLS.join(', ')}`);
  }
  if (isSpecType(slug)) {
    throw new Error(`the kind "${slug}" already exists`);
  }
  // A kind's template spec is template-<slug>. A slug that is itself a reserved
  // id would not collide there, but the id space is one namespace and a kind
  // named after a served document is a trap worth closing at the only point
  // that can close it.
  if (RESERVED_IDS.has(slug) || RESERVED_IDS.has(templateIdFor(slug))) {
    throw new Error(`the id "${slug}" is reserved`);
  }

  const row = {
    slug,
    label: clean(name, MAX_LABEL),
    shell,
    whenToUse: clean(whenToUse, MAX_WHEN),
    created: Date.now(),
  };
  const existing = customTypes().map(({ builtin, ...keep }) => keep);
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({ custom: [...existing, row] }, null, 2));
  return { ...row, builtin: false, templateId: templateIdFor(slug) };
}

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
 * The kinds that ship with the plugin: the shell each scaffolds from, and the
 * line that decides whether it is the right one.
 *
 * 'impl' is the full Stages/Tasks + live tracker + Runtime shell; 'doc' is the
 * chrome-only shell.
 *
 * `whenToUse` used to exist only on kinds the user added, because six slugs are
 * few enough to choose between by name and the create skill carried its own
 * descriptions inline. Neither is true now. The skill's copy went stale the
 * moment a kind was added, and a list long enough to need descriptions is a list
 * that has to carry them itself. Each line says what the kind is for and, where
 * a neighbour is easy to confuse it with, what it is not for: the failure this
 * prevents is picking the first plausible kind rather than the best one.
 */
export const BUILTIN = {
  general: {
    shell: 'doc',
    whenToUse: 'A document none of the other kinds fits: a proposal, a policy, a '
      + 'postmortem, a runbook, a brief. Scaffolds the chrome and a TL;DR, and you '
      + 'choose every section from the use case. The fallback, not a way to avoid '
      + 'choosing: check the other kinds first, and if the document needs stages and '
      + 'tasks it is a design-impl or impl spec instead.',
  },
  design: {
    shell: 'doc',
    whenToUse: 'How something should be built: architecture, components, alternatives '
      + 'and the decisions between them. No build plan. Pick design-impl instead when '
      + 'the design will be implemented from the same document, and a design 1 pager '
      + 'when the direction has not been approved yet.',
  },
  research: {
    shell: 'doc',
    whenToUse: 'A specific question that has a right answer, investigated and reported: '
      + 'method, findings, evidence, a verdict. Pick exploration-spec instead when the '
      + 'subject is a space to map rather than a question to settle, and '
      + 'code-exploration-spec when the subject is code we own.',
  },
  deck: {
    shell: 'doc',
    whenToUse: 'A presentation: slides, in order, each carrying one point. Pick this '
      + 'when the artifact is shown rather than read, and a document kind for anything '
      + 'that has to survive being read alone.',
  },
  'design-impl': {
    shell: 'impl',
    whenToUse: 'A design and the plan to build it, in one document: the design sections '
      + 'plus stages, tasks and a tracker. The common choice for work that will be '
      + 'built. Pick design instead when nobody is building it yet, and impl when the '
      + 'design already exists elsewhere.',
  },
  impl: {
    shell: 'impl',
    whenToUse: 'The build plan for a design that already exists: stages, tasks and a '
      + 'tracker, with only enough design prose to orient. Never standalone. Pick '
      + 'design-impl instead when the design is being written at the same time.',
  },
};

/**
 * Kind to shell family. Derived, so the table above stays the one definition.
 *
 * Kept as an export because it is what callers outside this module actually
 * want, and it was the shape they already imported.
 */
export const BUILTIN_SHELL = Object.fromEntries(
  Object.entries(BUILTIN).map(([slug, t]) => [slug, t.shell]),
);

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
  const seen = new Set(Object.keys(BUILTIN));
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
  if (Object.hasOwn(BUILTIN, slug)) {
    return {
      slug,
      label: slug,
      shell: BUILTIN[slug].shell,
      whenToUse: BUILTIN[slug].whenToUse,
      created: 0,
      builtin: true,
    };
  }
  return customTypes().find((t) => t.slug === slug) || null;
}

/** Every kind's slug: the built-ins in their own order, then customs in theirs. */
export function specTypes() {
  return [...Object.keys(BUILTIN), ...customTypes().map((t) => t.slug)];
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
  writeCustom([...existing, row]);
  return { ...row, builtin: false, templateId: templateIdFor(slug) };
}

/** Persist the custom rows, dropping the derived `builtin` flag. */
function writeCustom(rows) {
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(typesPath(), JSON.stringify({
    custom: rows.map(({ builtin, ...keep }) => keep),
  }, null, 2));
}

/**
 * Remove a custom kind's row.
 *
 * Owns the row and nothing else: the caller removes the template spec, because
 * this module reads the filesystem and knows nothing about specs (the same
 * dependency rule that put the registry in its own file). types-api does both,
 * in that order.
 *
 * Throws for a built-in rather than returning false. There is no row to remove,
 * the kind is defined in code, and a quiet false would let a caller report a
 * removal that could never happen (I7).
 *
 * @returns {boolean} whether a row was removed
 */
export function removeCustomType(slug) {
  if (Object.hasOwn(BUILTIN, slug)) {
    throw new Error(`"${slug}" is a built-in kind and cannot be removed`);
  }
  const rows = customTypes();
  const kept = rows.filter((t) => t.slug !== slug);
  if (kept.length === rows.length) return false;
  writeCustom(kept);
  return true;
}

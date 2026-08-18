// The SpecForge component library: the one place a component is defined.
//
// Five consumers read this module, and three of them replaced a hard-coded list
// of their own to do it:
//
//   1. templates/components.css   the stylesheet stamped into every spec
//   2. lib/lint-spec.mjs          the registry the components check validates against
//   3. lib/lint-spec.mjs          the commentability allow-list (was hard-coded)
//   4. lib/html-to-md.mjs         the notice types markdown export preserves (was hard-coded)
//   5. the library document       served at /components, generated from these entries
//
// A component added here appears in all five. That is the property the whole
// design rests on: before it, the three lists were each correct when written and
// none knew about the others.
//
// The prose rules live with the definitions rather than in a separate document
// because a rule that is not beside the thing it governs goes stale.

import { headings } from './headings.mjs';
import { notices, calloutBase } from './notices.mjs';
import { inline } from './inline.mjs';
import { data } from './data.mjs';
import { code } from './code.mjs';
import { structure } from './structure.mjs';
import { spec } from './spec.mjs';

/**
 * Families, in the order the library document and the rules file present them.
 *
 * `heading` leads, because the outline is the first choice an author makes about
 * a block of prose and every other family sits inside one.
 */
export const FAMILIES = ['heading', 'notice', 'inline', 'data', 'code', 'structure', 'spec'];

/**
 * The two collections, and the field that decides which one a component is in.
 *
 * `static` is everything that is finished once the stylesheet is stamped.
 * `interactive` is a block that responds to a reader. They differ in what they
 * ship (a served script as well as the stamped CSS) and in where they are
 * documented, and in nothing else: one registry, one build, one stamped block.
 *
 * A second definitions directory with a second builder was the alternative and
 * is what this exists to avoid. Two builders emitting into one stamped block is
 * how six copies of the table rules accumulated across five shells and the
 * library page, one of which had silently disabled the heading family.
 */
export const LAYERS = ['static', 'interactive'];

/** A component's layer. Undeclared is `static`, so the 39 that predate this field keep working. */
export function layerOf(c) {
  return c.layer === 'interactive' ? 'interactive' : 'static';
}

/** Every component in one layer, in definition order. */
export function componentsIn(layer) {
  return COMPONENTS.filter((c) => layerOf(c) === layer);
}

/**
 * What a component needs at runtime beyond its stamped CSS.
 *
 * `none` covers both a static component and an interactive one built on an
 * element that is already interactive (`<details>`). `script` is what makes the
 * review layer fetch /public/interactive.js, and it is read per document rather
 * than per component so a spec using only disclosures loads nothing.
 */
export function needsOf(c) {
  return c.needs === 'script' ? 'script' : 'none';
}

/**
 * How the library spends color.
 *
 * Four tokens carry all of it, and each means one thing:
 *
 *   --accent   orients. Which section, which number, which step is next. It is
 *              structural and it never judges.
 *   --green    good: passed, met, chosen.
 *   --amber    caution: unverified, risky, a hazard to know about.
 *   --red      bad: broken, irreversible, departed from.
 *
 * Everything else is --ink, --muted, and the three surfaces. Two consequences
 * worth stating because they are what stops the palette turning decorative:
 *
 * A container is never colored. A panel, a card and a figure hold other
 * components, and a tinted container competes with whatever is inside it. What
 * takes color is the thing a reader is looking for — the number in a stat, the
 * header of a table, the counter on a step.
 *
 * Nothing is a literal color. Every rule above is a token or a color-mix of one,
 * which is the whole reason the eight review-layer themes re-tint the library
 * without knowing any component's name. A hex in a component definition is a
 * component that has opted out of the themes.
 */
export const PALETTE_ROLES = {
  accent: 'orientation: which section, which number, which step',
  green: 'good: passed, met, chosen',
  amber: 'caution: unverified, risky, a hazard',
  red: 'bad: broken, irreversible, departed from',
};

/** The color axis. A notice names one; nothing else in the library has a tone. */
export const TONES = ['neutral', 'positive', 'caution', 'critical'];

/** Base rules that are not a component of their own. */
export const BASE_CSS = calloutBase;

/**
 * Carrier classes: real classes an author writes, which are not components in
 * their own right. `.callout` is the block; the 12 notice types are what a spec
 * chooses between, and one never appears without the other.
 */
export const BASE_CLASSES = ['callout'];

/**
 * Every component, in family order.
 *
 * @typedef {object} Component
 * @property {string} name        the class name, or the element name when kind is 'element'
 * @property {string} family      one of FAMILIES
 * @property {'class'|'element'} kind
 * @property {boolean} block      block-level, and therefore a comment target
 * @property {string} rule        when this component applies
 * @property {string[]} requires  what the block must contain to be well formed
 * @property {string} [tone]      notices only
 * @property {string} [label]     notices only; generated by CSS, never typed
 * @property {string[]} [variants] modifier classes that ride on this component
 * @property {string} [css]
 * @property {string} example
 */
export const COMPONENTS = [...headings, ...notices, ...inline, ...data, ...code, ...structure, ...spec];

/** The class names the lint accepts. Elements are not classes and are excluded. */
export function componentClasses() {
  return [...BASE_CLASSES, ...COMPONENTS.filter((c) => c.kind === 'class').map((c) => c.name)];
}

/**
 * Blocks a reviewer can comment on. The commentability check reads this instead
 * of its own list, which is why `.evidence` no longer trips it.
 */
export function blockComponents() {
  return [...BASE_CLASSES, ...COMPONENTS.filter((c) => c.block && c.kind === 'class').map((c) => c.name)];
}

/** The 12 notice types, for the lint and for markdown export. */
export function noticeTypes() {
  return COMPONENTS.filter((c) => c.family === 'notice').map((c) => c.name);
}

/** A component by name, or undefined. */
export function component(name) {
  return COMPONENTS.find((c) => c.name === name);
}

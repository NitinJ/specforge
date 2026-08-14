// The components lint check.
//
// Advisory in v1 (design D4). The inventory is a prediction made from 111
// sampled specs, and a hard failure before it has covered real authoring turns
// every gap in that prediction into a blocked author. It reports, names the
// component that likely fits, and never fails the lint. It turns hard once a
// version passes with nobody needing a class the library lacks.
//
// It runs only on specs carrying `data-sf-components`. That keeps D5 true of the
// lint as well as of the stamp: the 113 specs already in the store never opted
// in, and their lint result does not change.

import { COMPONENTS, componentClasses, noticeTypes } from '../components/index.mjs';
import { VERSION } from './components-build.mjs';
import { ATTR, optedIn } from './components-stamp.mjs';

/** Tone classes that used to ride on `.callout` directly, and what replaced them. */
const LEGACY_TONE = {
  warn: ['warning', 'assumption', 'risk'],
  good: ['success', 'tip'],
  bad: ['danger', 'deviation'],
};

/** One notice per this many words of prose. Asserted, not measured (design Q3). */
export const WORDS_PER_NOTICE = 400;

/** Classes that are not components but are not drift either. */
const IGNORED = new Set([
  // Template chrome: the shell's own layout, which the library does not own.
  'layout', 'toc', 'brand', 'tag-mini', 'sub', 'field', 'active', 'wide',
  // Deck vocabulary, until Stage 7.
  'slide', 'deck-nav', 'filmstrip',
]);

const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
};

/**
 * The library component an unknown class most resembles, or null.
 *
 * Reporting "unknown class" alone leaves an author to search the rules file.
 * `c-risk` should say `risk`, which is what makes the advisory actionable rather
 * than merely correct.
 */
export function nearest(name) {
  const known = componentClasses();
  let best = null;
  let bestScore = Infinity;
  for (const k of known) {
    // A prefix or suffix relationship is the common shape of an invented name
    // (c-risk, c-win, sl-tag), so it beats raw distance.
    const affix = name.endsWith(k) || name.startsWith(k) || k.endsWith(name);
    const score = affix ? 0.5 : editDistance(name, k);
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return bestScore <= 2.5 ? best : null;
}

/** Every class applied in body markup, with a count. */
function usedClasses(html) {
  const body = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const out = new Map();
  for (const m of body.matchAll(/class\s*=\s*["']([^"']*)["']/g)) {
    for (const c of m[1].trim().split(/\s+/).filter(Boolean)) out.set(c, (out.get(c) || 0) + 1);
  }
  return out;
}

/** Words of prose, for the density rule. */
function wordCount(html) {
  const prose = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  return prose ? prose.split(/\s+/).length : 0;
}

/**
 * @param {string} html
 * @returns {{applies:boolean, problems:string[]}} `applies` is false for a
 *   pre-library spec, which is reported as nothing rather than as clean.
 */
export function checkComponents(html) {
  // From the <html> tag only. A spec that writes the attribute name in prose has
  // not opted in, and the design spec for this library does exactly that.
  if (!optedIn(html)) return { applies: false, problems: [] };
  const attr = (html.match(/<html\b[^>]*>/) || [''])[0].match(new RegExp(`${ATTR}="(\\d+)"`));

  const problems = [];

  // 1. The stamped block is current. A spec at an older version is not wrong,
  //    it is out of date, and `components sync` is the fix.
  const start = html.match(/specforge:components v(\d+) start/);
  if (!start) problems.push('carries the version attribute but no stamped block; run components sync');
  else if (Number(start[1]) !== VERSION || Number(attr[1]) !== VERSION) {
    problems.push(`stamped block is v${start[1]} and the library is v${VERSION}; run components sync`);
  }

  const used = usedClasses(html);
  const known = new Set(componentClasses());
  const variants = new Set(COMPONENTS.flatMap((c) => c.variants || []));
  const types = new Set(noticeTypes());

  // 2. A notice with no type. The measured failure: 273 of 640 callouts.
  const untyped = [...html.matchAll(/class\s*=\s*["']([^"']*\bcallout\b[^"']*)["']/g)]
    .map((m) => m[1].trim().split(/\s+/))
    .filter((cls) => !cls.some((c) => types.has(c)));
  if (untyped.length) {
    const legacy = untyped.filter((cls) => cls.some((c) => LEGACY_TONE[c]));
    if (legacy.length) {
      const seen = [...new Set(legacy.flatMap((cls) => cls.filter((c) => LEGACY_TONE[c])))];
      for (const tone of seen) {
        problems.push(`${legacy.length}x notice using the tone class "${tone}" directly; a tone follows from a type, so use ${LEGACY_TONE[tone].join(', ')}`);
      }
    }
    const bare = untyped.length - legacy.length;
    if (bare > 0) problems.push(`${bare}x notice with no type; every callout takes one of ${[...types].join(', ')}`);
  }

  // 3. Classes outside the library.
  const stray = [...used.keys()]
    .filter((c) => !known.has(c) && !variants.has(c) && !types.has(c) && !IGNORED.has(c))
    .filter((c) => !/^(sf|sfui)-/.test(c)); // review-layer chrome, not a spec class
  if (stray.length) {
    const named = stray.slice(0, 8).map((c) => {
      const near = nearest(c);
      return near ? `${c} (did you mean ${near}?)` : c;
    });
    problems.push(`${stray.length} class(es) outside the library: ${named.join(', ')}`);
  }

  // 4. Density. Emphasis everywhere is emphasis nowhere.
  const notices = [...html.matchAll(/class\s*=\s*["'][^"']*\bcallout\b[^"']*["']/g)].length;
  const words = wordCount(html);
  const allowed = Math.max(1, Math.ceil(words / WORDS_PER_NOTICE));
  if (notices > allowed) {
    problems.push(`${notices} notices in ${words} words; the density rule is one per ${WORDS_PER_NOTICE}, so at most ${allowed} here`);
  }

  return { applies: true, problems };
}

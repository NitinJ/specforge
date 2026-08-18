// The eight checks the lint has always run, as rule records.
//
// Moved here verbatim from lib/lint-spec.mjs: same ids, same severities, same
// detail strings. `lintSpec` is now a wrapper over these, and the promise the
// whole refactor hangs on is that a caller cannot tell the difference. Five
// skills and eight test files import it.
//
// `spec-components` is conditional: it reports only on specs that opted into the
// component library, so the 113 pre-library specs stay silent. That is expressed
// here as `applies`, which the runner reads to decide whether the rule produces
// a verdict at all.

import { duplicateSectionIds, checkThemeContract, checkPalette } from '../spec.mjs';
import { blockComponents } from '../../components/index.mjs';
import { checkComponents } from '../components-lint.mjs';
import { checkLanguage } from '../spec-language.mjs';
import { defineRule } from './index.mjs';

const RE_TITLE = /<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>|<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i;
const RE_STATUS = /data-sf-spec-status\s*=\s*["'][^"']+["']/i;

// The review layer only anchors comments to a known block set. Generated deck /
// card markup often traps text directly inside a bare <div>, which is then
// un-commentable. Derived from the component definitions rather than listed,
// because this was a hand-kept list and it was already wrong once: `.evidence`
// is a block component and tripped the check because nobody updated both
// places. The extras are pre-library shapes specs still use.
const COMMENTABLE_DIV_CLASSES = new Set([...blockComponents(), 'q', 'bar', 'ns']);
const COMMENTABILITY_WARN_THRESHOLD = 2;

function countTrappedContentDivs(html) {
  let n = 0;
  const re = /<div\b([^>]*)>\s*[^<\s]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const cls = (m[1].match(/class\s*=\s*["']([^"']*)["']/i) || [, ''])[1];
    if (!cls.split(/\s+/).some((c) => COMMENTABLE_DIV_CLASSES.has(c))) n++;
  }
  return n;
}

export const STRUCTURAL_RULES = [
  defineRule({
    id: 'has-title',
    title: 'The spec has a title',
    severity: 'blocking',
    check: (html) => {
      const ok = RE_TITLE.test(html);
      return { ok, detail: ok ? 'present' : 'no <h1>/<title> with text' };
    },
    fix: 'Give the spec an <h1> (and a matching <title>).',
  }),

  defineRule({
    id: 'has-status',
    title: 'The spec declares a lifecycle status',
    severity: 'blocking',
    check: (html) => {
      const ok = RE_STATUS.test(html);
      return { ok, detail: ok ? 'present' : 'no data-sf-spec-status' };
    },
    fix: 'Add data-sf-spec-status="draft" to the body.',
  }),

  defineRule({
    id: 'unique-section-ids',
    title: 'Section ids are unique',
    severity: 'blocking',
    check: (html) => {
      const dups = duplicateSectionIds(html);
      return {
        ok: dups.length === 0,
        detail: dups.length ? `duplicates: ${dups.join(', ')}` : 'all unique',
      };
    },
    fix: 'Rename the duplicate ids. Comments anchor to them, so a duplicate loses comments.',
  }),

  defineRule({
    id: 'theme-contract',
    title: 'Light and dark are both declared',
    severity: 'blocking',
    check: (html) => {
      const theme = checkThemeContract(html);
      return { ok: theme.ok, detail: theme.ok ? 'light/dark OK' : `missing: ${theme.missing.join(', ')}` };
    },
    fix: 'Restore the theme block: :root vars, a [data-theme="light"] override, and prefers-color-scheme.',
  }),

  defineRule({
    id: 'palette-tokens',
    title: 'The canonical palette tokens are defined',
    severity: 'blocking',
    check: (html) => {
      const palette = checkPalette(html);
      return {
        ok: palette.ok,
        detail: palette.ok
          ? 'canonical tokens defined'
          : `missing: ${palette.missing.map((t) => '--' + t).join(', ')}`,
      };
    },
    fix: 'Define every canonical token. Derive any tint with color-mix() rather than inventing a name.',
  }),

  defineRule({
    id: 'commentability',
    title: 'Text sits in blocks the review layer can anchor to',
    severity: 'advisory',
    check: (html) => {
      const trapped = countTrappedContentDivs(html);
      return {
        ok: trapped <= COMMENTABILITY_WARN_THRESHOLD,
        detail: trapped === 0
          ? 'all content in commentable blocks'
          : `${trapped} div(s) hold text directly — wrap it in a <p>/<li> or a .card/.panel/.stat/.callout so reviewers can comment on it`,
      };
    },
    fix: 'Wrap the trapped text in a <p>/<li> or one of the commentable block components.',
  }),

  defineRule({
    id: 'spec-components',
    title: 'Classes come from the component library',
    severity: 'advisory',
    check: (html) => {
      const comp = checkComponents(html);
      if (!comp.applies) return { applies: false };
      return {
        ok: comp.problems.length === 0,
        detail: comp.problems.length === 0 ? 'every component is in the library' : comp.problems.join('; '),
      };
    },
    fix: 'Use a library component, or add the new one to components/ first.',
  }),

  defineRule({
    id: 'disclosure-depth',
    title: 'A disclosure holds detail, not a division of the document',
    severity: 'advisory',
    check: (html) => {
      // Scanned by depth rather than by matching a <details>…</details> pair.
      // A non-greedy pair stops at the FIRST closing tag, so with one disclosure
      // nested in another it sees only the inner block and a heading in the
      // outer one after it goes unreported — which is the shape most likely to
      // hide an argument, since it is the deepest.
      const tokens = [...html.matchAll(/<details\b[^>]*>|<\/details\s*>|<(h[23])\b/gi)];
      if (!tokens.some((t) => /^<details\b/i.test(t[0]))) return { applies: false };
      const buried = [];
      let depth = 0;
      for (const t of tokens) {
        if (/^<details\b/i.test(t[0])) depth += 1;
        else if (/^<\/details/i.test(t[0])) depth = Math.max(0, depth - 1);
        else if (depth > 0) buried.push(t[1].toLowerCase());
      }
      // h4 and h5 are deliberately not counted. h4 is the deepest level the
      // contents rail lists and h5 is a label; neither is a division of the
      // document, which is the thing that must not be hidden behind a summary.
      return {
        ok: buried.length === 0,
        detail: buried.length === 0
          ? 'no section heading is hidden behind a summary'
          : `${buried.length} section heading(s) inside a disclosure (${[...new Set(buried)].sort().join(', ')}) — a reader who does not open it misses that part of the argument`,
      };
    },
    fix: 'Move the h2/h3 and its content out of the disclosure, or demote it to an h4 if it is genuinely detail.',
  }),

  defineRule({
    id: 'spec-language',
    title: "The language contract's mechanical subset",
    severity: 'advisory',
    check: (html) => {
      const lang = checkLanguage(html);
      return {
        ok: lang.length === 0,
        detail: lang.length === 0
          ? 'no banned patterns found'
          : lang.map((r) => `${r.count}× ${r.name} (${r.fix})`).join('; '),
      };
    },
    fix: 'Rewrite the flagged phrases. See references/spec-language.md.',
  }),
];

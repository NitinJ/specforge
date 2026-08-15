// The global rule list: what every spec is checked against whatever its type.
//
// Families A to D were reasoned from the language contract and the shape of the
// shell. Family E was derived the other way, from 274 review comments mined
// across 20 specs, and each of its rules is one that has already been asked for
// repeatedly in review. Where a corpus rule and a reasoned rule said the same
// thing they were merged into the corpus rule, which names the narrow case
// explicitly (D11) — so `no-repeated-claims` covers what `decisions-match-prose`
// used to, and `prescriptions-name-their-source` covers `numbers-have-provenance`.
//
// Type-scoped rules are NOT here. A rule that applies to one spec type lives in
// that type's template block, where it is prose you can edit without a PR (D12).
//
// The eight rules the lint has always run live in ./structural.mjs and are
// spliced in below, so this file plus that one IS the global list.

import { getSectionIds } from '../spec.mjs';
import { defineRule } from './index.mjs';
import { STRUCTURAL_RULES } from './structural.mjs';

// Two copies on purpose. A /g regex carries lastIndex between calls, so the one
// used with .test() must not be the one used with .match(); sharing them makes
// every other .test() return false.
const RE_PLACEHOLDER_ALL = /\{\{[^}]*\}\}/g;
const RE_PLACEHOLDER = /\{\{[^}]*\}\}/;

/** Every `<section …>…</section>` as {id, inner}. Specs do not nest sections. */
function sections(html) {
  const out = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [, null])[1];
    out.push({ id, inner: m[2] });
  }
  return out;
}

/**
 * Does this section body carry anything beyond its heading?
 *
 * A diagram or a table with no prose is content, so text is not the only way to
 * be non-empty. Getting this wrong in the other direction would be worse: a rule
 * that calls a section of SVG "empty" trains the author to ignore it.
 */
function hasBodyBeyondHeading(inner) {
  const withoutHeadings = inner.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ');
  if (/<(svg|img|table|pre|figure)\b/i.test(withoutHeadings)) return true;
  return withoutHeadings.replace(/<[^>]+>/g, ' ').trim().length > 0;
}

/**
 * Everything that is not prose, removed.
 *
 * The exemptions are not politeness, they are places where the rule's advice
 * cannot be taken. A diagram label cannot be a link. A code block's filename
 * caption is naming the listing below it, not referring the reader elsewhere.
 * Code and pre are samples. And text already inside an <a> is the thing the rule
 * is asking for.
 */
function bareProse(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')     // a diagram label cannot be a link
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<span\b[^>]*class="[^"]*\bfilename\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')
    .replace(/<a\b[\s\S]*?<\/a>/gi, ' ')       // already a link: not this rule's business
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Code samples, removed. A placeholder inside one is documentation. */
function withoutCode(html) {
  return String(html)
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ');
}

/** The document text before the first section: title, date, status, owner. */
function frontMatter(html) {
  const cut = html.search(/<section\b/);
  const head = cut === -1 ? html : html.slice(0, cut);
  return head.replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

export const GLOBAL_RULES = [
  // ── A. Scaffolding not finished ───────────────────────────────────────────
  // Mechanical, high hit rate, and the failures a reader notices first.

  defineRule({
    id: 'no-placeholders',
    title: 'No scaffolding placeholders remain',
    severity: 'blocking',
    check: (html) => {
      // Code samples are exempt. A spec documenting the shell's own syntax
      // writes `{{ … }}` inside <code>, and failing it for that would mean the
      // rule cannot be described in a spec.
      const left = withoutCode(html).match(RE_PLACEHOLDER_ALL) || [];
      return {
        ok: left.length === 0,
        detail: left.length ? `${left.length} left: ${left.slice(0, 3).join(' ')}` : 'none',
      };
    },
    fix: 'Replace each one, or delete the block if the section does not apply.',
  }),

  defineRule({
    id: 'no-empty-sections',
    title: 'Every section holds something beyond its heading',
    severity: 'blocking',
    check: (html) => {
      const empty = sections(html).filter((s) => !hasBodyBeyondHeading(s.inner)).map((s) => s.id || '(unnamed)');
      return {
        ok: empty.length === 0,
        detail: empty.length ? `empty: ${empty.join(', ')}` : 'all sections carry content',
      };
    },
    fix: 'Write the section, or delete it. An empty section is a promise the spec does not keep.',
  }),

  defineRule({
    id: 'toc-in-sync',
    title: 'The table of contents matches the sections',
    severity: 'blocking',
    check: (html) => {
      const nav = html.match(/<nav\b[^>]*class="[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
      if (!nav) return { applies: false };
      const linked = [...nav[1].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      const present = getSectionIds(html);
      const stale = linked.filter((id) => !present.includes(id));
      const unlisted = present.filter((id) => !linked.includes(id));
      const problems = [];
      if (stale.length) problems.push(`links to nothing: ${stale.join(', ')}`);
      if (unlisted.length) problems.push(`sections not linked: ${unlisted.join(', ')}`);
      return {
        ok: problems.length === 0,
        detail: problems.length ? problems.join('; ') : `${linked.length} entries, all resolving`,
      };
    },
    fix: 'Add the missing entries and drop the stale ones. A stale link and an unlisted section are the same defect.',
  }),

  defineRule({
    id: 'front-matter-filled',
    title: 'Title, date, owner and status are real values',
    severity: 'blocking',
    check: (html) => {
      const head = frontMatter(html);
      const missing = [];
      const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      const titleText = h1 ? h1[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!titleText || RE_PLACEHOLDER.test(titleText)) missing.push('title');
      if (!/\b\d{4}-\d{2}-\d{2}\b/.test(head)) missing.push('date');
      const owner = head.match(/owner:\s*([^<·\n]*)/i);
      if (!owner || !owner[1].trim() || owner[1].includes('{{')) missing.push('owner');
      const status = html.match(/data-sf-spec-status\s*=\s*["']([^"']*)["']/i);
      if (!status || !status[1].trim() || status[1].includes('{{')) missing.push('status');
      return {
        ok: missing.length === 0,
        detail: missing.length ? `not filled in: ${missing.join(', ')}` : 'title, date, owner, status all set',
      };
    },
    fix: "Fill the front matter with real values, not the shell's defaults.",
  }),

  defineRule({
    id: 'section-is-more-than-a-stub',
    title: 'No section is a heading plus a restatement of the heading',
    severity: 'advisory',
    ask: 'No section is a heading plus a single sentence that restates the heading. Length alone does not decide it: a two-line section that says something is finished, and a long one that says nothing is not.',
    fix: 'Write what the section is for, or fold it into the section it belongs to.',
  }),

  // ── B. Claims without support ─────────────────────────────────────────────
  // Where a judged rule earns its cost. None of these is a pattern.

  defineRule({
    id: 'decisions-have-reasons',
    title: 'Every decision gives a reason, not a restatement',
    severity: 'blocking',
    ask: 'Every decision row gives a reason, not a restatement of the choice. "Chose X because X is the right approach" is a restatement.',
    fix: 'Say what the choice buys and what it costs, or record it as an open question.',
  }),

  defineRule({
    id: 'options-have-verdicts',
    title: 'Every option is chosen or rejected, and says why',
    severity: 'blocking',
    ask: 'Every option in a comparison is marked chosen or rejected and says why. An option table where nothing is chosen is a list, not a decision.',
    fix: 'Mark the verdict on each row, or delete the comparison.',
  }),

  defineRule({
    id: 'rejections-are-real',
    title: 'Rejected options are ones somebody could have picked',
    severity: 'advisory',
    ask: 'Rejected options are ones somebody could have picked. A straw man makes the chosen option look inevitable and teaches the reader nothing.',
    fix: 'Replace the straw man with the option a reasonable person would argue for, or drop the row.',
  }),

  defineRule({
    id: 'file-refs-are-real',
    title: 'Cited paths, functions and lines exist as written',
    severity: 'blocking',
    ask: 'Every cited path, function or line reference exists as written. Check them against the tree rather than from memory: a spec becomes untrustworthy fastest by citing code that has since moved.',
    fix: 'Correct the reference, or say that it is proposed rather than existing.',
  }),

  defineRule({
    id: 'costs-are-stated',
    title: 'A claimed benefit says what it costs',
    severity: 'advisory',
    ask: 'Where the spec claims a benefit, it also states what the choice costs. A design with only upsides has not been thought through in public.',
    fix: 'Name the cost, even when it is small. "No cost" is itself a claim worth writing.',
  }),

  // ── C. Internal contradiction ─────────────────────────────────────────────
  // A spec that disagrees with itself is worse than one that is merely thin:
  // the reader cannot tell which half to trust.

  defineRule({
    id: 'tldr-matches-body',
    title: 'The TL;DR is supported by the body',
    severity: 'blocking',
    ask: 'Every claim in the TL;DR is supported by the body and contradicted by none of it. The TL;DR is read first, skimmed by everyone, and written earliest, so it is the claim most likely to be stale.',
    fix: 'Rewrite the TL;DR from the finished body rather than editing it in place.',
  }),

  defineRule({
    id: 'resolved-stays-resolved',
    title: 'A question is open in one place or closed in all of them',
    severity: 'blocking',
    ask: 'A question marked resolved is not described as open elsewhere, and a question still open is not treated as settled by the prose around it.',
    fix: 'Pick the true state and make every mention agree with it.',
  }),

  defineRule({
    id: 'internal-links-resolve',
    title: 'Every in-document anchor points at something',
    severity: 'blocking',
    check: (html) => {
      // `<a href="#x">` only. An SVG `<use href="#sym">` points at a symbol, not
      // at a place in the document, and the deck shell has one; treating it as a
      // broken anchor would fail every deck ever made. Comments are stripped for
      // the same reason: the shells explain their own markup inside them.
      const live = html.replace(/<!--[\s\S]*?-->/g, ' ');
      const ids = new Set([...live.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const broken = [...new Set(
        [...live.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)].map((m) => m[1]).filter((t) => t && !ids.has(t)),
      )];
      return {
        ok: broken.length === 0,
        detail: broken.length ? `no target: ${broken.map((b) => '#' + b).join(', ')}` : 'all anchors resolve',
      };
    },
    fix: 'Point the link at a section that exists, or add the id it is looking for.',
  }),

  defineRule({
    id: 'terms-are-stable',
    title: 'One name per concept throughout',
    severity: 'advisory',
    ask: 'One name per concept throughout, and where the reader supplied a term in review, that term is the one used. A spec that calls the same thing three names makes the reader do the joining.',
    fix: 'Pick one name and sweep the document for the others.',
  }),

  defineRule({
    id: 'diagrams-match-text',
    title: 'The diagram and the prose describe the same system',
    severity: 'advisory',
    ask: 'Every node and edge in a diagram appears in the prose, and the prose names nothing the diagram contradicts.',
    fix: 'Redraw the diagram from the prose, or correct the prose.',
  }),

  // ── D. Language contract ──────────────────────────────────────────────────
  // The mechanical slice is `spec-language` in ./structural.mjs. The rest is the
  // part references/spec-language.md says a regex cannot see, and it says so.

  defineRule({
    id: 'every-sentence-carries',
    title: 'Each sentence carries something',
    severity: 'advisory',
    ask: 'Each sentence carries a decision, a measurement, a source, an assumption or a specification. One that carries none gets cut. This is the language contract\'s first rule and the one it says cannot be checked mechanically.',
    fix: 'Cut the sentence. If cutting it loses something, that something is what the sentence should have said.',
  }),

  defineRule({
    id: 'no-aphorisms',
    title: 'No line that works as a standalone tweet',
    severity: 'advisory',
    ask: 'No line that works as a standalone tweet. The contract\'s own example: "A limit discovered through an upload failure is a support ticket" is not a spec; "Limits (25 MB, 8000 px, 3 files) render as chips on the dropzone" is.',
    fix: 'Replace the aphorism with the parameter, the threshold or the behaviour it was gesturing at.',
  }),

  defineRule({
    id: 'resolution-not-persuasion',
    title: 'The spec resolves rather than sells',
    severity: 'advisory',
    ask: 'The spec assumes the reader has agreed to the direction, and spends its words on resolution rather than selling.',
    fix: 'Delete the argument for the direction. Keep the argument between the options inside it.',
  }),

  defineRule({
    id: 'unknowns-are-written-down',
    title: 'An undecided threshold says it is undecided',
    severity: 'blocking',
    ask: 'A threshold, limit or parameter that has not been decided says so. An omitted threshold reads as "no threshold", which is a decision nobody made.',
    fix: 'Give the value, or write the unknown down as an open question with an id.',
  }),

  // ── E. From the comment corpus ────────────────────────────────────────────
  // Derived from 274 review comments across 20 specs. A rule here has already
  // been asked for, repeatedly, in review.

  defineRule({
    id: 'entities-are-explained',
    title: 'Every named thing says what it is and what it is for',
    severity: 'blocking',
    ask: 'Every named thing the spec introduces says what it is, why it exists, and what it is for. A list of names is not a description.',
    fix: 'Give each name a line: what it is, why it exists, what uses it.',
  }),

  defineRule({
    id: 'references-are-links',
    title: 'A reference is a link, not a bare name',
    severity: 'blocking',
    check: (html) => {
      const prose = bareProse(html);
      const hits = [
        ...new Set([
          ...(prose.match(/\b[\w-]+(?:\/[\w.-]+)*\.(?:mjs|js|ts|html|css|md|json|sh|py)\b/g) || []),
          ...(prose.match(/§\d+(?:\.\d+|\.[A-Z])?/g) || []),
        ]),
      ];
      return {
        ok: hits.length === 0,
        detail: hits.length
          ? `${hits.length} bare reference(s): ${hits.slice(0, 4).join(', ')}`
          : 'every reference is a link',
      };
    },
    fix: 'Wrap the reference in an <a>. A reference the reader cannot click is one they have to go and find.',
  }),

  defineRule({
    id: 'no-repeated-claims',
    title: 'No claim appears twice, and none contradicts another',
    severity: 'blocking',
    ask: 'No claim or decision appears twice, and none contradicts another. Includes the case the Decisions table and the Design section disagree about what was decided, which is the usual way this fails: a decision changes late and one of the two is updated.',
    fix: 'Keep the claim in one place and link to it from the other.',
  }),

  defineRule({
    id: 'fields-are-documented',
    title: 'Every field carries a one-line definition',
    severity: 'advisory',
    ask: 'Every field or column in a data table carries a one-line definition, placed before the field rather than after it.',
    fix: 'Add the definition above each field, so it is read before the thing it defines.',
  }),

  defineRule({
    id: 'prescriptions-name-their-source',
    title: 'A number or a practice names where it came from',
    severity: 'blocking',
    ask: 'Where the spec states a number as fact or prescribes a practice, it names where that came from: a measurement, a standard, a best practice, or an explicit label as an assumption. A number with none is a guess wearing a uniform.',
    fix: 'Cite the measurement or the standard, or mark the number as an assumption.',
  }),
];

// The four mechanical scaffolding rules are declared first above, so the eight
// existing lint checks splice in after them and family A reads as one block.
// A test pins this, because a constant that silently drifts reorders the report.
export const SCAFFOLDING_RULE_COUNT = 4;

/**
 * The complete global list: the eight rules the lint has always run, plus the
 * rules above. Ordered scaffolding-first, which is the order a reader fixes them
 * in — a placeholder left in the title is worth knowing about before a judgement
 * on whether the TL;DR overclaims.
 */
export const ALL_GLOBAL_RULES = [
  ...GLOBAL_RULES.slice(0, SCAFFOLDING_RULE_COUNT),
  ...STRUCTURAL_RULES,
  ...GLOBAL_RULES.slice(SCAFFOLDING_RULE_COUNT),
];

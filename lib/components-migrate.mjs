// Moving one spec onto the library, on request (D5).
//
// Two passes, because the work splits cleanly in two. A class rename is
// mechanical and belongs in code. Choosing between `warning`, `assumption` and
// `risk` for a block requires reading it, which is the agent pass: the CLI hands
// out a work list, an agent assigns types, and anything it leaves takes the
// classifier's default so the spec never sits half on each vocabulary.
//
// The rename table is narrower than it first looks, and the store is why. The
// design named eight private callout vocabularies to rename; measuring them
// found the same words on chips, cards and tables, where they mean something
// else entirely — `asm` is 31 uses and one of them is a callout. So a rename is
// qualified by the context that gives the class exactly one target, which is the
// design's own criterion applied to what is actually there. Everything else is
// left alone, alongside the 338 classes only one spec uses.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { noticeTypes } from '../components/index.mjs';
import { specDir, specHtmlPath, assertSpecId } from './store-paths.mjs';
import { stampHtml } from './components-stamp.mjs';

/** Report format version, so a later reader knows what it is looking at. */
export const REPORT_VERSION = 1;

/**
 * The deterministic renames.
 *
 * `within` is the guard: the other classes that must be on the same element for
 * the rename to have one meaning. A rename with no guard is one the store shows
 * in a single context.
 */
export const RENAMES = [
  { from: 'c-risk', to: 'risk', within: ['callout'] },
  { from: 'c-win', to: 'success', within: ['callout'] },
  { from: 'c-key', to: 'note', within: ['callout'] },
  { from: 'asm', to: 'assumption', within: ['callout'] },
  { from: 'caut', to: 'warning', within: ['callout'] },
  { from: 'dec', to: 'decision', within: ['callout'] },
  { from: 'hon', to: 'assumption', within: ['callout'] },
  { from: 'win', to: 'success', within: ['callout'] },
  { from: 'ok', to: 'good', within: ['tag'] },
  { from: 'grid2', to: 'grid' },
  // The element already carries the meaning, so the class is dropped rather than
  // renamed. Only on a real <figure>: the store also has `div.fig`, which is not
  // one.
  { from: 'fig', to: null, on: 'figure' },
];

const TAG_RE = /<([a-z][a-z0-9]*)\b([^>]*?)(\/?)>/gi;
// Either quote. An imported spec is written by whatever produced it, and the
// lint already reads both, so a migration that read one would report success
// over callouts it had left on the legacy vocabulary.
const CLASS_RE = /\bclass\s*=\s*(["'])([\s\S]*?)\1/i;

/** Replace an element's class list, keeping the quote character it was written with. */
function withClasses(attrs, classes) {
  if (!classes.length) return attrs.replace(/\s*\bclass\s*=\s*(["'])[\s\S]*?\1/i, '');
  return attrs.replace(CLASS_RE, (_, q) => `class=${q}${classes.join(' ')}${q}`);
}

/**
 * Elements whose contents a browser does not parse as markup.
 *
 * Inside one of these, `<div class='callout warn'>` is a string a script builds
 * or a sample a reader looks at, not an element anything renders. Rewriting it
 * edits a spec's own behaviour, which is the one thing a migration must not do.
 *
 * A `<template>` is deliberately absent: its contents ARE parsed as markup and
 * are cloned into the document, so a callout in one is a callout.
 */
const RAW_TEXT_RE = /(<(script|style|textarea|title)\b[^>]*>)([\s\S]*?)<\/\2\s*>/gi;

/**
 * Character ranges holding raw text rather than markup.
 *
 * The body's offset is the opening tag's length, not the result of searching the
 * match for the body text. Searching finds the wrong occurrence when an
 * attribute happens to hold the same string the body does, and the range then
 * covers the attribute while leaving the body reachable — the opposite of what
 * this exists to do.
 */
export function rawRanges(html) {
  const out = [];
  let m;
  RAW_TEXT_RE.lastIndex = 0;
  while ((m = RAW_TEXT_RE.exec(html))) {
    const from = m.index + m[1].length;
    out.push([from, from + m[3].length]);
  }
  return out;
}

const inRanges = (ranges, at) => ranges.some(([from, to]) => at >= from && at < to);

/**
 * Apply every deterministic rename.
 *
 * Rewrites class attributes on tags and nothing else. That confinement is the
 * safety property: a spec's own stylesheet names these classes in rules, and a
 * spec about the library shows them inside escaped code examples. Neither is
 * markup, so neither is reachable from here.
 *
 * @returns {{html:string, changes:Array<{from:string,to:string|null,count:number}>}}
 */
export function codemod(html) {
  const counts = new Map();
  const raw = rawRanges(html);
  const out = html.replace(TAG_RE, (tag, name, attrs, selfClose, offset) => {
    if (inRanges(raw, offset)) return tag;
    const cm = CLASS_RE.exec(attrs);
    if (!cm) return tag;
    const classes = cm[2].split(/\s+/).filter(Boolean);
    let next = classes;
    let hit = false;
    for (const r of RENAMES) {
      if (!next.includes(r.from)) continue;
      if (r.on && r.on !== name.toLowerCase()) continue;
      if (r.within && !r.within.every((c) => next.includes(c))) continue;
      next = r.to === null
        ? next.filter((c) => c !== r.from)
        : next.map((c) => (c === r.from ? r.to : c));
      counts.set(r, (counts.get(r) || 0) + 1);
      hit = true;
    }
    if (!hit) return tag;
    // An emptied class attribute is removed rather than left as class="": the
    // element it was on says what the class said.
    return `<${name}${withClasses(attrs, next)}${selfClose}>`;
  });
  const changes = RENAMES
    .filter((r) => counts.has(r))
    .map((r) => ({ from: r.from, to: r.to, count: counts.get(r) }));
  return { html: out, changes };
}

/**
 * The classifier, from design §12.
 *
 * Signals only. Real legacy blocks are prose and mostly carry none, which is the
 * point of the agent pass; what this guarantees is that a block nobody reads
 * still lands on the weakest claim in its group rather than on nothing.
 *
 * Order is the table's order: the first type that matches wins.
 */
const SIGNALS = {
  warn: [
    ['trigger and consequence', /\btrigger\s*:/i, 'risk'],
    ['a condition and a loss', /\b(if|when|once)\b[\s\S]*\b(breaks?|fails?|loses?|lost|corrupts?|overwrites?|wedges?|deletes?)\b/i, 'risk'],
    ['a falsifier', /\bfalsified by\s*:/i, 'assumption'],
    ['an unverified belief', /\b(we (believe|assume)|assumes?|assumption|unverified|not verified|would make this wrong)\b/i, 'assumption'],
    ['a cited source', /\bsource\s*:/i, 'constraint'],
    ['a limit with a unit', /\b(must|cannot|never|no more than|under|at most)\b[\s\S]*?\b\d+(\.\d+)?\s?(ms|s|kb|mb|gb|px|%|per second|req\/s)\b/i, 'constraint'],
  ],
  '': [
    ['an alternative not taken', /\bnot taken\s*:/i, 'decision'],
    ['a stated criterion', /\bcriterion\s*:/i, 'decision'],
    ['a choice over an alternative', /\b(chose|chosen|picked|decided|selected)\b[\s\S]*\b(instead of|rather than|over|alternative)\b/i, 'decision'],
    ['an instance of a rule', /\b(for example|for instance|e\.g\.)\b/i, 'example'],
  ],
  good: [
    ['an action the reader may skip', /\b(you can|consider|prefer|worth|optional|safe to (ignore|skip))\b/i, 'tip'],
  ],
  bad: [
    ['a departure from a stated rule', /\b(departs? from|deviat|violates?|contrary to|against the (rule|principle))\b/i, 'deviation'],
  ],
};

/** The weakest claim in each group, per §12. An inference understates. */
const DEFAULTS = { warn: 'warning', '': 'note', good: 'success', bad: 'danger' };

/**
 * @param {string} text  the block's text, tags stripped
 * @param {string} source  the legacy variant: 'warn', 'good', 'bad' or '' for bare
 * @returns {{type:string, signal:string|null}}
 */
export function classify(text, source) {
  const rules = SIGNALS[source] || SIGNALS[''];
  for (const [signal, re, type] of rules) {
    if (re.test(text)) return { type, signal };
  }
  return { type: DEFAULTS[source] !== undefined ? DEFAULTS[source] : DEFAULTS[''], signal: null };
}

const CALLOUT_RE = /<div\b([^>]*\bclass\s*=\s*(["'])([\s\S]*?)\2[^>]*)>([\s\S]*?)<\/div>/gi;
const LEGACY_SOURCES = new Set(['warn', 'good', 'bad']);

/**
 * A block's identity for an assignment: the first 10 hex of a hash over its
 * legacy source and its text.
 *
 * Not its position. A plan and the apply that follows it are two runs against a
 * file a person can edit in between, and a document-order index that has since
 * moved points a decision at a different block without anything noticing. A hash
 * either finds the block the agent read or finds nothing, and finding nothing is
 * reported.
 *
 * The source is in the hash, not only the text. Both inputs decide the
 * assignment: the same sentence under `warn` and under `good` is a different
 * claim, and an agent that read it as one must not have its answer applied to
 * the other.
 *
 * Two blocks with identical source and text share a key and take the same type,
 * which is the right answer: identical blocks classify identically.
 */
export function blockKey(text, source = '') {
  return createHash('sha256').update(`${source}\n${text}`).digest('hex').slice(0, 10);
}

/**
 * Callouts still carrying no type: what the agent pass reads.
 *
 * `index` is the occurrence number among callouts in document order, and is how
 * the apply finds the block to rewrite within a single run. `key` is how an
 * assignment names one across runs.
 */
export function ambiguousBlocks(html) {
  const types = new Set(noticeTypes());
  const raw = rawRanges(html);
  const out = [];
  let index = 0;
  let m;
  CALLOUT_RE.lastIndex = 0;
  while ((m = CALLOUT_RE.exec(html))) {
    if (inRanges(raw, m.index)) continue;
    const classes = m[3].split(/\s+/).filter(Boolean);
    if (!classes.includes('callout')) continue;
    const i = index;
    index += 1;
    if (classes.some((c) => types.has(c))) continue;
    const source = classes.find((c) => LEGACY_SOURCES.has(c)) || '';
    const text = m[4].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ index: i, key: blockKey(text, source), source, text });
  }
  return out;
}

/** Write a type onto the callout at `index`, replacing the legacy variant. */
function applyType(html, index, type) {
  const raw = rawRanges(html);
  let seen = 0;
  return html.replace(CALLOUT_RE, (full, attrs, quote, cls, body, offset) => {
    if (inRanges(raw, offset)) return full;
    const classes = cls.split(/\s+/).filter(Boolean);
    if (!classes.includes('callout')) return full;
    const i = seen;
    seen += 1;
    if (i !== index) return full;
    const next = ['callout', type, ...classes.filter((c) => c !== 'callout' && !LEGACY_SOURCES.has(c))];
    return `<div${withClasses(attrs, next)}>${body}</div>`;
  });
}

/** Library class names the spec's own stylesheet also defines. */
function conflicts(html, introduced) {
  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  if (!style) return [];
  // Only the spec's own rules: the stamped block defines all of them by design.
  const own = style[1].replace(/\/\* specforge:components v\d+ start[\s\S]*?\/\* specforge:components end(?: sha=[0-9a-f]+)? \*\//, '');
  return [...introduced].filter((c) => new RegExp(`\\.${c}\\b`).test(own)).sort();
}

export function reportPath(id) {
  return join(specDir(id), 'migration.json');
}

/** The migration report, or null if the spec has never been migrated. */
export function readReport(id) {
  try {
    return JSON.parse(readFileSync(reportPath(id), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Migrate one spec.
 *
 * Finalizes rather than stopping on ambiguity: a migration that stops leaves the
 * spec in neither vocabulary, and there are more untyped blocks in the store
 * than anyone will work through by hand. What an agent did not decide, the
 * classifier does, and the report says which was which.
 *
 * @param {string} id
 * @param {{dry?:boolean, assign?:Record<string,string>, now?:number}} [opts]
 *   `assign` is keyed by block key, not by position: see blockKey.
 */
export function migrateSpec(id, opts = {}) {
  assertSpecId(id);
  const path = specHtmlPath(id);
  if (!existsSync(path)) throw new Error(`migrate: spec ${id} not found`);
  const types = new Set(noticeTypes());
  const assign = opts.assign || {};
  for (const [k, v] of Object.entries(assign)) {
    if (!types.has(v)) throw new Error(`migrate: "${v}" is not a notice type (block ${k})`);
  }

  const before = readFileSync(path, 'utf8');
  const pass1 = codemod(before);
  let html = pass1.html;

  const blocks = ambiguousBlocks(html);
  // An assignment that matches nothing is the plan having gone stale, and it is
  // reported rather than dropped: the alternative is a decision silently
  // replaced by a default on a block nobody looked at again.
  const present = new Set(blocks.map((b) => b.key));
  const unmatched = Object.keys(assign).filter((k) => !present.has(k));
  if (unmatched.length) {
    throw new Error(`migrate: ${unmatched.length} assignment(s) name a block that is no longer there `
      + `(${unmatched.join(', ')}); re-run --plan and reassign`);
  }

  const assignments = [];
  for (const block of blocks) {
    const chosen = assign[block.key];
    const { type, signal } = chosen
      ? { type: chosen, signal: null }
      : classify(block.text, block.source);
    html = applyType(html, block.index, type);
    assignments.push({
      index: block.index,
      key: block.key,
      source: block.source,
      assigned: type,
      by: chosen ? 'agent' : 'classifier',
      signal: chosen ? null : signal,
      text: block.text.slice(0, 240),
    });
  }

  html = stampHtml(html);

  const introduced = new Set([
    ...pass1.changes.filter((c) => c.to).map((c) => c.to),
    ...assignments.map((a) => a.assigned),
  ]);
  const report = {
    id,
    version: REPORT_VERSION,
    at: opts.now || Date.now(),
    codemod: pass1.changes,
    assignments,
    conflicts: conflicts(html, introduced),
    changed: html !== before,
  };
  if (opts.dry) return report;
  writeFileSync(path, html);
  writeFileSync(reportPath(id), JSON.stringify(report, null, 2));
  return report;
}

// Spec navigation engine: turn one structured spec .html into a resident section
// MAP + a tiny on-demand search/grep/xref tool surface, so an LLM agent can
// navigate the spec without reading the whole file.
//
// Reuses lib/spec.mjs for parsing (it owns the spec format) and lib/bm25.mjs for
// ranking. The index is deterministic (document order) and cheap to rebuild from
// scratch on every save — see writeIndex()/loadIndex() in spec-nav-index.mjs.

import { getAttr, sectionBody, parsePlan } from './spec.mjs';
import { build as buildBm25, search as bm25Search, snippet as bm25Snippet, tokenize, topTerms } from './bm25.mjs';

/** Strip HTML tags + collapse whitespace to plain text. */
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** First sentence (or first ~120 chars) of plain prose — a one-line summary. */
function firstSentence(text) {
  const flat = stripTags(text);
  if (!flat) return '';
  const m = flat.match(/^.*?[.!?](?:\s|$)/);
  const s = (m ? m[0] : flat).trim();
  return s.length > 160 ? s.slice(0, 159).trimEnd() + '…' : s;
}

/** Cheap token estimate: words * 1.3 (matches the order-of-magnitude in the design). */
function tokenEst(text) {
  const words = stripTags(text).split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

/** The 1-based line number at a character offset. */
function lineAt(html, charOffset) {
  let line = 1;
  for (let i = 0; i < charOffset && i < html.length; i++) if (html[i] === '\n') line++;
  return line;
}

/** Heading text + level (2..4) for a section body, or {header:'', level:2}. */
function headingOf(body) {
  const m = body.match(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return { header: '', level: 2 };
  return { header: stripTags(m[2]), level: Number(m[1][1]) };
}

/**
 * Split a spec into section units, with char + line spans.
 * @returns {{id,header,level,text,html,charStart,charEnd,lineStart,lineEnd}[]}
 */
export function sections(html) {
  const out = [];
  const re = /<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const inner = m[2];
    const charStart = m.index;
    const charEnd = m.index + m[0].length;
    const { header, level } = headingOf(inner);
    out.push({
      id,
      header,
      level,
      html: inner,
      text: stripTags(inner),
      charStart,
      charEnd,
      lineStart: lineAt(html, charStart),
      lineEnd: lineAt(html, charEnd),
    });
  }
  return out;
}

/** Intra-doc anchors (href="#id") inside a section body, in document order, deduped. */
function anchorsIn(body, validIds) {
  const refs = [];
  const re = /href="#([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    const id = m[1];
    if (validIds.has(id) && !refs.includes(id)) refs.push(id);
  }
  return refs;
}

/**
 * Build the navigation index for a spec.
 * @param {string} html raw spec HTML
 * @returns {object} the on-disk index shape (docMap + sections[])
 */
export function buildIndex(html) {
  const units = sections(html);
  const ids = units.map((u) => u.id);
  const idSet = new Set(ids);
  const bm = buildBm25(units.map((u) => ({ id: u.id, heading: u.header, text: u.text })));

  const indexed = units.map((u, i) => ({
    id: u.id,
    header: u.header,
    level: u.level,
    summary: firstSentence(u.html),
    charStart: u.charStart,
    charEnd: u.charEnd,
    lineStart: u.lineStart,
    lineEnd: u.lineEnd,
    tokenEst: tokenEst(u.html),
    neighborIds: [units[i - 1]?.id, units[i + 1]?.id].filter(Boolean),
    keyTerms: topTerms(bm, u.id, 6),
    refsTo: anchorsIn(u.html, idSet),
  }));

  return {
    docMap: {
      order: ids,
      byLevel: indexed.reduce((acc, s) => {
        (acc[s.level] ||= []).push(s.id);
        return acc;
      }, {}),
      plan: parsePlan(html),
    },
    sections: indexed,
  };
}

/** Rebuild the in-memory BM25 index from the stored section list (sub-ms for one doc). */
function bm25From(index, html) {
  const bodies = new Map(sections(html).map((u) => [u.id, { heading: u.header, text: u.text }]));
  return buildBm25(index.sections.map((s) => ({
    id: s.id,
    heading: bodies.get(s.id)?.heading ?? s.header,
    text: bodies.get(s.id)?.text ?? '',
  })));
}

/** Look up a section descriptor from the index by id, or null. */
function descriptor(index, id) {
  return index.sections.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// Tool surface
// ---------------------------------------------------------------------------

/** The resident doc map: order, levels, plan, and per-section header/summary/range/tokens. */
export function map(index) {
  return {
    order: index.docMap.order,
    plan: index.docMap.plan,
    sections: index.sections.map((s) => ({
      id: s.id,
      header: s.header,
      level: s.level,
      summary: s.summary,
      tokenEst: s.tokenEst,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      keyTerms: s.keyTerms,
    })),
  };
}

/**
 * One section's body text + descriptor. Reads the body from ground-truth HTML
 * (via sectionBody) so it is never stale relative to the file.
 */
export function section(index, html, id) {
  const d = descriptor(index, id);
  if (!d) return null;
  const body = sectionBody(html, id) ?? '';
  return {
    id: d.id,
    header: d.header,
    level: d.level,
    lineStart: d.lineStart,
    lineEnd: d.lineEnd,
    neighborIds: d.neighborIds,
    refsTo: d.refsTo,
    text: stripTags(body),
  };
}

/**
 * Regex over section text — returns matching sections with the matched line.
 * @returns {{id,header,line,match}[]}
 */
export function grep(html, regex) {
  const re = typeof regex === 'string' ? new RegExp(regex, 'i') : regex;
  const out = [];
  for (const u of sections(html)) {
    // Match against the raw section body line-by-line so line numbers are real.
    const lines = u.html.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const plain = stripTags(lines[i]);
      if (plain && re.test(plain)) {
        out.push({ id: u.id, header: u.header, line: u.lineStart + i, match: plain.slice(0, 160) });
        break; // one hit per section keeps output compact (use search for ranking)
      }
    }
  }
  return out;
}

/** BM25-ranked sections for a query → [{id, header, score, snippet, lineStart, lineEnd}]. */
export function search(index, html, query, opts = {}) {
  const bm = bm25From(index, html);
  return bm25Search(bm, query, opts).map((h) => {
    const d = descriptor(index, h.id);
    return {
      id: h.id,
      header: d?.header ?? '',
      score: Number(h.score.toFixed(3)),
      snippet: h.snippet,
      lineStart: d?.lineStart,
      lineEnd: d?.lineEnd,
    };
  });
}

/**
 * Context window around an anchor: a section id, a 1-based line number, or a text
 * match. Returns ±ctx lines with the matched line marked.
 * @param {string} html
 * @param {string|number} anchor section id | line number | search text
 * @param {number} [ctx] lines of context on each side
 */
export function around(html, anchor, ctx = 3) {
  const lines = html.split('\n');
  let center = null;

  if (typeof anchor === 'number' || /^\d+$/.test(String(anchor))) {
    center = Number(anchor);
  } else {
    const d = descriptor(buildIndex(html), String(anchor));
    if (d) {
      center = d.lineStart;
    } else {
      const needle = String(anchor).toLowerCase();
      const i = lines.findIndex((l) => stripTags(l).toLowerCase().includes(needle));
      if (i !== -1) center = i + 1;
    }
  }
  if (center == null) return null;

  const start = Math.max(1, center - ctx);
  const end = Math.min(lines.length, center + ctx);
  const window = [];
  for (let n = start; n <= end; n++) {
    window.push({ line: n, mark: n === center, text: lines[n - 1] });
  }
  return { center, start, end, lines: window };
}

/** Structural adjacency: prev/next siblings in document order for a section id. */
export function neighbors(index, id) {
  const order = index.docMap.order;
  const i = order.indexOf(id);
  if (i === -1) return null;
  const d = descriptor(index, id);
  const ref = (sid) => (sid ? { id: sid, header: descriptor(index, sid)?.header ?? '' } : null);
  return {
    id,
    header: d?.header ?? '',
    prev: ref(order[i - 1]),
    next: ref(order[i + 1]),
  };
}

/**
 * Cross-references for a section: outbound (refsTo via #anchor) + inbound
 * (sections whose refsTo includes id, OR that mention id's header / a keyTerm).
 * @returns {{id,header,refsTo:[],refsFrom:[]}|null}
 */
export function xrefs(index, id) {
  const d = descriptor(index, id);
  if (!d) return null;

  // Inbound signals: explicit anchor links, plus prose mentions of the section's
  // header or any of its key terms (the spec analog of "find references").
  const headerTerms = tokenize(d.header);
  const mentionTerms = new Set([...headerTerms, ...d.keyTerms].filter((t) => t.length > 2));

  const refsFrom = [];
  for (const s of index.sections) {
    if (s.id === id) continue;
    let why = null;
    if (s.refsTo.includes(id)) {
      why = 'anchor';
    } else if (mentionTerms.size) {
      const st = new Set([...tokenize(s.header), ...s.keyTerms]);
      if ([...mentionTerms].some((t) => st.has(t))) why = 'mention';
    }
    if (why) refsFrom.push({ id: s.id, header: s.header, via: why });
  }

  return {
    id,
    header: d.header,
    refsTo: d.refsTo.map((rid) => ({ id: rid, header: descriptor(index, rid)?.header ?? '' })),
    refsFrom,
  };
}

export { stripTags, bm25Snippet };

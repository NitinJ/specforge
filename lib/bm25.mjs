// Zero-dependency Okapi BM25 over short documents (SpecForge: sections-as-docs).
//
// The corpus is the set of sections within ONE spec — tens of short units, not a
// many-document repo — so a hand-rolled BM25 is more than adequate and keeps the
// plugin dependency-free (see specs/specforge/research/impl-options-node.md).
//
// Each document carries two fields: a heading and a body. Heading terms are
// weighted higher (HEADING_BOOST) so "the section about X" ranks the section
// whose *title* is X above one that merely mentions X in prose.

const K1 = 1.4;
const B = 0.75;
const HEADING_BOOST = 3;

// A small, conservative stopword set. Kept tiny on purpose: at one-doc scale the
// IDF term already deweights ubiquitous words, and over-pruning hurts recall on
// short technical prose.
const STOP = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'be', 'this', 'that', 'it', 'as', 'at', 'by', 'with', 'from',
]);

/** Lowercase, split on non-alphanumerics, keep numbers/identifiers, drop stopwords. */
export function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOP.has(t));
}

/** Per-document term frequencies (heading terms counted HEADING_BOOST times). */
function termFreqs(heading, body) {
  const tf = new Map();
  const add = (term, weight) => tf.set(term, (tf.get(term) || 0) + weight);
  for (const t of tokenize(heading)) add(t, HEADING_BOOST);
  for (const t of tokenize(body)) add(t, 1);
  return tf;
}

/**
 * Build a BM25 index over documents.
 * @param {{id:string, heading?:string, text:string}[]} docs
 * @returns {{docs:{id,tf:Map,len:number,heading:string,text:string}[], df:Map, avgdl:number, N:number}}
 */
export function build(docs) {
  const built = docs.map((d) => {
    const tf = termFreqs(d.heading || '', d.text || '');
    let len = 0;
    for (const v of tf.values()) len += v;
    return { id: d.id, tf, len, heading: d.heading || '', text: d.text || '' };
  });
  const df = new Map();
  for (const d of built) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const total = built.reduce((a, d) => a + d.len, 0);
  return { docs: built, df, avgdl: built.length ? total / built.length : 0, N: built.length };
}

function idf(index, term) {
  const n = index.df.get(term) || 0;
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
}

/**
 * Extract a one-line snippet from `text` around the first query-term hit.
 * @param {string} text plain (already tag-stripped) text
 * @param {Set<string>} qterms query term set
 * @param {number} [width] approximate snippet length in characters
 */
export function snippet(text, qterms, width = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let hit = -1;
  for (const t of qterms) {
    const i = lower.search(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (i !== -1 && (hit === -1 || i < hit)) hit = i;
  }
  if (hit === -1) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  let start = Math.max(0, hit - Math.floor(width / 3));
  // snap to a word boundary so snippets don't start mid-word
  if (start > 0) {
    const sp = flat.indexOf(' ', start);
    if (sp !== -1 && sp - start < 20) start = sp + 1;
  }
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}

/**
 * Rank documents against a query (Okapi BM25 with heading-boosted term freqs).
 * @param {ReturnType<typeof build>} index
 * @param {string} query
 * @param {{limit?:number}} [opts]
 * @returns {{id:string, score:number, snippet:string}[]} ranked, score > 0 only
 */
export function search(index, query, { limit = 10 } = {}) {
  const q = tokenize(query);
  const qset = new Set(q);
  const ranked = [];
  for (const d of index.docs) {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const denom = f + K1 * (1 - B + (B * d.len) / (index.avgdl || 1));
      score += idf(index, t) * (f * (K1 + 1)) / denom;
    }
    if (score > 0) ranked.push({ id: d.id, score, snippet: snippet(d.text, qset) });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked.slice(0, limit);
}

/** Top-N highest-tf terms for a document (cheap section fingerprint). */
export function topTerms(index, id, n = 6) {
  const d = index.docs.find((x) => x.id === id);
  if (!d) return [];
  return [...d.tf.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}

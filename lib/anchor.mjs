// Hybrid comment anchoring (design D2). An anchor binds to a stable section id
// plus an optional text quote inside it. Resolution degrades gracefully so a
// comment is never silently lost:
//
//   precise  — the exact quote is found (prefix/suffix disambiguated)
//   moved    — the quote moved/changed slightly but a confident span was found
//   section  — no good text match; fall back to highlighting the whole section
//   orphaned — the section itself is gone
//
// Operates on the section's plain text so it mirrors the client's DOM-based
// highlighting (which works on textContent).

import { sectionBody } from './spec.mjs';

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
  '&mdash;': '—', '&ndash;': '–', '&lsquo;': '‘', '&rsquo;': '’',
  '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…', '&middot;': '·',
  '&bull;': '•', '&copy;': '©', '&reg;': '®', '&trade;': '™',
};

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Decode numeric and common named HTML entities (browser selection text is fully decoded). */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Convert section HTML to plain text the way a browser's textContent would. */
export function toText(htmlFragment) {
  return decodeEntities(htmlFragment.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function allIndexes(haystack, needle) {
  const out = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

/** Locate a quote within section text. @returns {{status,start,end}|null} */
function locate(text, quote) {
  const exact = norm(quote.exact || '');
  if (!exact) return null;
  const t = norm(text);
  const pre = norm(quote.prefix || '');
  const suf = norm(quote.suffix || '');

  const hits = allIndexes(t, exact);
  if (hits.length === 1) return { status: 'precise', start: hits[0], end: hits[0] + exact.length };
  if (hits.length > 1) {
    const disambiguated = hits.find((i) => {
      const before = t.slice(0, i);
      const after = t.slice(i + exact.length);
      return (!pre || before.endsWith(pre)) && (!suf || after.startsWith(suf));
    });
    const i = disambiguated ?? hits[0];
    return { status: disambiguated != null ? 'precise' : 'moved', start: i, end: i + exact.length };
  }

  // Not found verbatim → edit-tolerant search via word coverage. Anchor the span
  // on the words that are still present, so a changed first/last word still
  // resolves to "moved" rather than being lost.
  const words = exact.split(' ').filter(Boolean);
  if (!words.length) return null;
  const present = words.filter((w) => t.includes(w));
  const coverage = present.length / words.length;
  if (coverage >= 0.6) {
    const firstW = present[0];
    const lastW = present[present.length - 1];
    const start = t.indexOf(firstW);
    if (start !== -1) {
      // End on the FIRST occurrence of the last surviving word at/after start, and
      // reject spans much larger than the quote (scattered words across a section
      // must not produce a section-wide "moved" highlight).
      const li = t.indexOf(lastW, start);
      const end = li === -1 ? start + firstW.length : li + lastW.length;
      const maxSpan = Math.max(60, exact.length * 3);
      if (end >= start && end - start <= maxSpan) {
        return { status: 'moved', start, end: Math.min(t.length, end) };
      }
    }
  }
  return null;
}

/**
 * Resolve an anchor against current spec HTML.
 * @param {string} html
 * @param {{sectionId:string, quote?:{exact:string,prefix?:string,suffix?:string}}} anchor
 * @returns {{status:'precise'|'moved'|'section'|'orphaned', sectionId:string, start?:number, end?:number}}
 */
export function resolveAnchor(html, anchor) {
  const sectionId = anchor?.sectionId;
  const body = sectionId ? sectionBody(html, sectionId) : null;
  if (body == null) return { status: 'orphaned', sectionId };
  if (!anchor.quote || !anchor.quote.exact) return { status: 'section', sectionId };
  const hit = locate(toText(body), anchor.quote);
  if (!hit) return { status: 'section', sectionId };
  return { status: hit.status, sectionId, start: hit.start, end: hit.end };
}

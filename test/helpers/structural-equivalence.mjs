// Structural equivalence for spec HTML: the round-trip contract in code.
//
// html → md → html' cannot be byte-identical and is not meant to be. Whitespace,
// attribute order, inline styles and tag classes are all documented losses. What
// MUST survive is the structure a reader and the store depend on: which sections
// exist and in what order, their headings, the plan's tasks and statuses, table
// cell text, code blocks with their language, and the diagram slots.
//
// Failures name the field that diverged (`sections[2].tables[0].rows[1]`) rather
// than dumping two documents and leaving the diff to the reader.

import assert from 'node:assert/strict';
import { getSectionIds, sectionBody, parsePlan, getTitle, getStatus } from '../../lib/spec.mjs';

/** Sections the importer regenerates rather than reads back (see the loop below). */
const DERIVED_SECTIONS = new Set(['task-tracker']);

/** Decode the entity subset the renderers emit. `&amp;` last, or `&amp;lt;` double-decodes. */
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Visible text of an HTML fragment: tags out, entities decoded, whitespace collapsed. */
export function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function headingsOf(body) {
  const out = [];
  const re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(body))) out.push({ level: Number(m[1]), text: textOf(m[2]) });
  return out;
}

function tablesOf(body) {
  const out = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/g;
  let t;
  while ((t = tableRe.exec(body))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    let r;
    while ((r = rowRe.exec(t[1]))) {
      const cells = [];
      const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/g;
      let c;
      while ((c = cellRe.exec(r[1]))) cells.push(textOf(c[2]));
      if (cells.length) rows.push(cells);
    }
    out.push({ rows });
  }
  return out;
}

function codeBlocksOf(body) {
  const out = [];
  const re = /<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g;
  let m;
  while ((m = re.exec(body))) {
    const cls = (m[1].match(/class\s*=\s*"([^"]*)"/) || [, ''])[1];
    const lang = (cls.match(/(?:lang|language)-([\w+-]+)/) || [, ''])[1] || '';
    // Only entities are decoded: indentation and newlines inside a code block are content.
    out.push({ lang, body: decodeEntities(m[2]).replace(/^\n/, '').replace(/\s+$/, '') });
  }
  return out;
}

/**
 * Diagram slots in document order. An inline <svg> and the <img> it becomes after
 * a round trip are the same slot: what is compared is the label, because the file
 * name is an export detail and the markup is not preserved by design.
 */
function diagramsOf(body) {
  const out = [];
  const re = /<svg\b([^>]*)>([\s\S]*?)<\/svg>|<img\b([^>]*)>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[3] !== undefined) {
      out.push({ label: textOf((m[3].match(/alt\s*=\s*"([^"]*)"/) || [, ''])[1]) });
      continue;
    }
    const attrs = m[1];
    const inner = m[2];
    const aria = (attrs.match(/aria-label\s*=\s*"([^"]*)"/) || [, ''])[1];
    const title = (inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/) || [, ''])[1];
    out.push({ label: textOf(aria || title) });
  }
  return out;
}

/**
 * Notices in document order, as {type, text}.
 *
 * The type is structure, not decoration. A tag's colour class is an accepted
 * loss (L1) because it restates what the text says; a notice's type is the only
 * place the block's meaning is recorded, so a round trip that drops it has
 * changed the document. Before the exporter derived its list from the library,
 * all 12 types came back as a bare callout and this assertion would not have
 * noticed.
 */
function noticesOf(body) {
  const out = [];
  const re = /<div\b([^>]*\bclass\s*=\s*"([^"]*\bcallout\b[^"]*)"[^>]*)>/g;
  let m;
  while ((m = re.exec(body))) {
    const classes = m[2].trim().split(/\s+/);
    const type = classes.find((c) => c !== 'callout') || '';
    const { start } = closeOf(body, re.lastIndex, 'div');
    out.push({ type, text: textOf(body.slice(re.lastIndex, start)) });
  }
  return out;
}

/** The end of the element opened at `from`, counting nested opens of `tag`. */
function closeOf(html, from, tag) {
  const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const gt = html.indexOf('>', m.index);
      return { start: m.index, end: gt === -1 ? html.length : gt + 1 };
    }
  }
  return { start: html.length, end: html.length };
}

/**
 * List items with their nesting depth, in document order.
 *
 * Depth is part of the comparison, not decoration: a round trip that flattened
 * "A connection error / DNS failure / TLS failure" into three siblings would
 * otherwise produce the same three strings and pass.
 *
 * Plan tasks are excluded because planOf() compares them by id and status;
 * counting them here as well would fail a correct round trip on list formatting.
 */
function listItemsOf(body, depth = 0, out = []) {
  const listRe = /<(ul|ol)\b([^>]*)>/gi;
  let m;
  while ((m = listRe.exec(body))) {
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const close = closeOf(body, start, tag);
    const inner = body.slice(start, close.start);
    listRe.lastIndex = close.end;
    if (/\bclass\s*=\s*"[^"]*sf-(?:tasks|stages)/i.test(m[2])) continue;
    itemsOf(inner, depth, out, tag === 'ol');
  }
  return out;
}

function itemsOf(inner, depth, out, ordered) {
  const liRe = /<li\b([^>]*)>/gi;
  let m;
  while ((m = liRe.exec(inner))) {
    const attrs = m[1];
    const start = m.index + m[0].length;
    const close = closeOf(inner, start, 'li');
    const body = inner.slice(start, close.start);
    liRe.lastIndex = close.end;
    if (/data-sf-(?:task|stage)/i.test(attrs)) continue;

    // The item's own text is what is left once its sub-lists are cut out.
    let own = body;
    const nested = [];
    const subRe = /<(ul|ol)\b[^>]*>/gi;
    let s;
    while ((s = subRe.exec(body))) {
      const subTag = s[1].toLowerCase();
      const subStart = s.index + s[0].length;
      const subClose = closeOf(body, subStart, subTag);
      nested.push(body.slice(s.index, subClose.end));
      subRe.lastIndex = subClose.end;
    }
    for (const n of nested) own = own.replace(n, ' ');

    // `ordered` is compared too: numbered steps and a bag of bullets are not the
    // same document, and without it an <ol> silently becoming a <ul> would pass.
    const text = textOf(own);
    if (text) out.push({ depth, ordered, text });
    for (const n of nested) listItemsOf(n, depth + 1, out);
  }
  return out;
}

function planOf(html) {
  return parsePlan(html).map((s) => ({
    stage: s.stage,
    pr: s.pr || '',
    tasks: s.tasks.map((t) => ({ id: t.id, status: t.status })),
  }));
}

/**
 * The comparable shape of a spec.
 * @param {string} html
 */
export function structuralModel(html) {
  const ids = getSectionIds(html);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  return {
    // Both, and not just getTitle(): it reads <title> and falls back to <h1>, so
    // an importer that set one and forgot the other would round-trip "clean".
    title: getTitle(html),
    h1: h1 ? textOf(h1[1]) : '',
    status: getStatus(html),
    sectionIds: ids,
    sections: ids.map((id) => {
      const body = sectionBody(html, id) || '';
      return {
        id,
        headings: headingsOf(body),
        tables: tablesOf(body),
        code: codeBlocksOf(body),
        diagrams: diagramsOf(body),
        notices: noticesOf(body),
        listItems: listItemsOf(body),
      };
    }),
    plan: planOf(html),
  };
}

/**
 * Assert two spec documents are structurally equivalent, naming the first field
 * that diverges.
 * @param {string} actual   HTML produced by the round trip
 * @param {string} expected HTML the round trip started from
 * @param {string} [label]  prefix for the failure message (usually the fixture name)
 */
export function assertStructurallyEquivalent(actual, expected, label = '') {
  const a = structuralModel(actual);
  const e = structuralModel(expected);
  const at = (field) => `${label ? `${label}: ` : ''}${field}`;

  assert.equal(a.title, e.title, at('title'));
  assert.equal(a.h1, e.h1, at('h1 (the on-page title)'));
  assert.equal(a.status, e.status, at('status'));
  assert.deepEqual(a.sectionIds, e.sectionIds, at('section ids and order'));

  for (let i = 0; i < e.sections.length; i++) {
    const as = a.sections[i];
    const es = e.sections[i];
    const where = `sections[${i}] (#${es.id})`;

    // A derived section is rebuilt from the plan on import, never carried through
    // the markdown. That it exists and sits in the same place is the contract;
    // its heading text and table are output of the tracker, not of the round trip.
    if (DERIVED_SECTIONS.has(es.id)) continue;

    // A section's own title is compared by text, not by level. Markdown gives a
    // section exactly one heading, so a title that lived in an <h4> inside a
    // panel (the house TL;DR) necessarily comes back as the section's <h2>.
    // Every heading below it is compared exactly, level included.
    const [aTitle, ...aRest] = as.headings;
    const [eTitle, ...eRest] = es.headings;
    assert.equal(aTitle?.text, eTitle?.text, at(`${where}.headings[0].text (the section title)`));
    assert.deepEqual(aRest, eRest, at(`${where}.headings (below the title)`));
    assert.equal(as.tables.length, es.tables.length, at(`${where}.tables.length`));
    for (let t = 0; t < es.tables.length; t++) {
      assert.deepEqual(as.tables[t].rows, es.tables[t].rows, at(`${where}.tables[${t}].rows`));
    }
    assert.deepEqual(as.code, es.code, at(`${where}.code`));
    assert.deepEqual(as.diagrams, es.diagrams, at(`${where}.diagrams`));
    assert.deepEqual(as.notices, es.notices, at(`${where}.notices (type and text)`));
    assert.deepEqual(as.listItems, es.listItems, at(`${where}.listItems`));
  }

  assert.deepEqual(a.plan, e.plan, at('plan (stages, tasks, statuses)'));
}

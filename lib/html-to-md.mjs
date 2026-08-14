// Spec HTML → SF-MD: GitHub-flavoured markdown that renders anywhere, plus the
// diagrams lifted out as sidecar files.
//
// The dialect is ordinary GFM. Structure markdown cannot carry rides in YAML
// frontmatter and in HTML comments, which every renderer drops silently. Markers
// are emitted only where they are load-bearing: a section id that its heading
// slug does not reproduce, a task status a checkbox cannot express, a diagram's
// identity. Most sections emit none.
//
// Parsing stays regex-and-scanner based, like lib/spec.mjs: SpecForge owns the
// format it is reading, and a DOM would be a runtime dependency.

import { getSectionIds, sectionBody, getTitle, getStatus } from './spec.mjs';
import { noticeTypes } from '../components/index.mjs';

/** Sections that are a rendering of other sections, and so are never exported. */
const DERIVED_SECTIONS = new Set(['task-tracker']);

/** Elements with no closing tag. */
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'col']);

/**
 * Notice types this exporter preserves.
 *
 * Derived from the component definitions rather than listed, which is the point:
 * this list used to be `['warn', 'good', 'bad']`, so all 12 library types
 * exported as a bare `<!-- sf:callout -->` and a deviation and a note came back
 * identical. A type added to the library reaches markdown with no second edit.
 *
 * The three legacy tone modifiers stay, because 640 callouts in the store carry
 * them and that markdown still has to open.
 */
export const CALLOUT_VARIANTS = [...new Set([...noticeTypes(), 'warn', 'good', 'bad'])];

// ---------------------------------------------------------------- scanning

/**
 * Walk an HTML fragment's top-level nodes in document order.
 * Yields `{kind:'text', text}` and `{kind:'el', tag, attrs, inner}`.
 * Nesting is handled by depth-counting the same tag name, which is sound here
 * because spec HTML is well formed and does not nest sections.
 */
export function* nodes(html) {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = html.slice(i);
      if (text) yield { kind: 'text', text };
      return;
    }
    if (lt > i) {
      // Whitespace-only text is yielded too. It is the space between two adjacent
      // inline elements, and dropping it ran `<code>a</code> <code>b</code>`
      // together into one unreadable token. Block-level consumers trim it away.
      const text = html.slice(i, lt);
      if (text) yield { kind: 'text', text };
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const open = matchOpenTag(html, lt);
    if (!open) { i = lt + 1; continue; }
    const { tag, attrs, end, selfClosing } = open;
    if (selfClosing || VOID.has(tag)) {
      yield { kind: 'el', tag, attrs, inner: '' };
      i = end;
      continue;
    }
    const close = findClose(html, end, tag);
    yield { kind: 'el', tag, attrs, inner: html.slice(end, close.start) };
    i = close.end;
  }
}

/** Parse an open tag at `pos`, respecting quoted attribute values. */
function matchOpenTag(html, pos) {
  const m = /^<([a-zA-Z][\w-]*)/.exec(html.slice(pos, pos + 40));
  if (!m) return null;
  const tag = m[1].toLowerCase();
  let i = pos + m[0].length;
  let quote = '';
  while (i < html.length) {
    const ch = html[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') {
      const attrs = html.slice(pos + m[0].length, i);
      return { tag, attrs, end: i + 1, selfClosing: /\/\s*$/.test(attrs) };
    }
    i++;
  }
  return null;
}

/** Find the close tag matching an already-opened `tag`, counting nested opens. */
function findClose(html, from, tag) {
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

/** An attribute's value, or ''. */
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function classes(attrs) {
  return new Set(attr(attrs, 'class').split(/\s+/).filter(Boolean));
}

// ---------------------------------------------------------------- text

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Plain visible text: tags out, entities decoded, whitespace collapsed. */
export function plainText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Escape the characters that would otherwise be markdown syntax.
 * `cell` mode skips the block-opening escapes: inside a table cell nothing opens
 * a block, so escaping a leading `#` there only produces a visible backslash.
 */
function escapeText(s, cell = false) {
  const inlineEscaped = s.replace(/([\\*`[\]])/g, '\\$1');
  if (cell) return inlineEscaped;
  return inlineEscaped
    .replace(/^(\s*)([#>+-])/gm, '$1\\$2')
    .replace(/^(\s*)(\d+)\./gm, '$1$2\\.');
}

/**
 * The slug a section id is compared against.
 *
 * House headings are numbered ("3 · Design", "12. Task tracker") while their ids
 * are not, so slugging the raw heading would differ from the id on essentially
 * every section and put a marker under all of them. The ordinal is display, not
 * identity: it comes off before the comparison.
 */
export function headingSlug(text) {
  return slug(String(text).replace(/^\s*\d+\s*[·.:)\]-]\s*/, ''));
}

/**
 * A value safe to put inside an `<!-- sf:… -->` marker.
 *
 * A `-->` would close the comment early and spill the rest into the document as
 * markdown; a quote would break the attribute the importer reads back. Ids and
 * statuses are well-formed in practice, so this is a guard rather than a fix for
 * anything observed.
 */
function markerValue(s) {
  return String(s).replace(/-->/g, '--').replace(/"/g, '');
}

/** Slugify a heading the way section ids are written: lowercase kebab. */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------- inline

/** Separator between two block-level parts that had to collapse onto one line. */
function joinBlocks(before, part, cell) {
  if (!part) return '';
  if (!before.trim()) return part;
  return (cell ? '<br>' : ' ') + part;
}

/**
 * Render inline content. `cell` mode keeps everything on one line, because a GFM
 * table cell is inline-only (loss ledger L3).
 */
function inline(html, ctx, cell = false) {
  let out = '';
  for (const n of nodes(html)) {
    if (n.kind === 'text') {
      out += escapeText(decodeEntities(n.text).replace(/\s+/g, ' '), cell);
      continue;
    }
    const { tag, attrs, inner } = n;
    switch (tag) {
      case 'strong': case 'b': {
        const t = inline(inner, ctx, cell).trim();
        out += t ? `**${t}**` : '';
        break;
      }
      case 'em': case 'i': {
        const t = inline(inner, ctx, cell).trim();
        out += t ? `*${t}*` : '';
        break;
      }
      case 'code': case 'kbd': {
        const t = decodeEntities(inner.replace(/<[^>]*>/g, ''));
        // A fence of backticks longer than any run inside the content.
        const longest = (t.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0);
        const fence = '`'.repeat(longest + 1);
        const pad = /^`|`$/.test(t) ? ' ' : '';
        out += `${fence}${pad}${t}${pad}${fence}`;
        break;
      }
      case 'a': {
        const href = attr(attrs, 'href');
        const t = inline(inner, ctx, cell).trim();
        out += href ? `[${t}](${href})` : t;
        break;
      }
      case 'img': {
        out += `![${attr(attrs, 'alt')}](${attr(attrs, 'src')})`;
        break;
      }
      case 'br': {
        // Two trailing spaces before the newline: that is a hard line break in
        // markdown. A bare newline is just whitespace, and the renderer joins the
        // lines back together.
        out += cell ? '<br>' : '  \n';
        break;
      }
      // Block content reached inline means a table cell holding a list or
      // paragraphs. GFM cells are inline-only, so the parts are joined rather
      // than run together: "two seconds" was never two items (loss ledger L3).
      case 'ul': case 'ol': {
        const items = [...nodes(inner)]
          .filter((x) => x.kind === 'el' && x.tag === 'li')
          .map((x) => inline(x.inner, ctx, cell).trim())
          .filter(Boolean);
        out += joinBlocks(out, items.join(cell ? '<br>' : ' '), cell);
        break;
      }
      case 'p': case 'li': case 'div': {
        out += joinBlocks(out, inline(inner, ctx, cell).trim(), cell);
        break;
      }
      default:
        // span, small, sup, abbr and friends: the text survives, the styling does
        // not (loss ledger L1).
        out += inline(inner, ctx, cell);
    }
  }
  return out;
}

// ---------------------------------------------------------------- blocks

function renderTable(inner, ctx) {
  const rows = [];
  for (const part of nodes(inner)) {
    if (part.kind !== 'el') continue;
    const scope = ['thead', 'tbody', 'tfoot'].includes(part.tag) ? part.inner : null;
    const source = scope === null ? inner : scope;
    if (scope === null && part.tag !== 'tr') continue;
    for (const tr of nodes(source)) {
      if (tr.kind !== 'el' || tr.tag !== 'tr') continue;
      const cells = [];
      for (const td of nodes(tr.inner)) {
        if (td.kind !== 'el' || (td.tag !== 'td' && td.tag !== 'th')) continue;
        if (/<(?:ul|ol|p|table|pre)\b/i.test(td.inner)) {
          ctx.warnings.push('a table cell held block content; it was flattened onto one line (L3)');
        }
        cells.push(inline(td.inner, ctx, true).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (scope === null) break;
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows;
  return [
    `| ${pad(head).join(' | ')} |`,
    `|${' --- |'.repeat(width)}`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n');
}

function renderCode(inner, ctx) {
  const code = [...nodes(inner)].find((n) => n.kind === 'el' && n.tag === 'code');
  const raw = code ? code.inner : inner;
  const lang = code ? (attr(code.attrs, 'class').match(/(?:lang|language)-([\w+-]+)/) || [, ''])[1] : '';
  const body = decodeEntities(raw).replace(/^\n/, '').replace(/\s+$/, '');
  const longest = (body.match(/^`{3,}/gm) || []).reduce((a, b) => Math.max(a, b.length), 2);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang || ''}\n${body}\n${fence}`;
}

function renderList(inner, ctx, ordered, depth) {
  const lines = [];
  let n = 0;
  for (const li of nodes(inner)) {
    if (li.kind !== 'el' || li.tag !== 'li') continue;
    n++;
    const marker = ordered ? `${n}.` : '-';
    const indent = '  '.repeat(depth);

    // A question item's state is a checkbox: open is unchecked, resolved is
    // checked, and only "dropped" needs a marker to survive.
    const q = attr(li.attrs, 'data-sf-q');
    const box = q ? (q === 'resolved' ? '[x] ' : '[ ] ') : '';

    const own = li.inner.replace(/<(ul|ol)\b[\s\S]*?<\/\1>\s*$/i, '');
    const nested = li.inner.slice(own.length);
    const text = inline(own, ctx).replace(/\s+/g, ' ').trim();
    let line = `${indent}${marker} ${box}${text}`;
    if (q === 'dropped') line += ` <!-- sf:q state="dropped" -->`;
    lines.push(line);

    for (const sub of nodes(nested)) {
      if (sub.kind === 'el' && (sub.tag === 'ul' || sub.tag === 'ol')) {
        const block = renderList(sub.inner, ctx, sub.tag === 'ol', depth + 1);
        if (block) lines.push(block);
      }
    }
  }
  return lines.join('\n');
}

/** `<ol class="sf-stages">`: stage headings plus a task list per stage. */
function renderPlan(inner, ctx) {
  const out = [];
  for (const stage of nodes(inner)) {
    if (stage.kind !== 'el' || stage.tag !== 'li') continue;
    const id = attr(stage.attrs, 'data-sf-stage');
    const pr = attr(stage.attrs, 'data-sf-pr');
    const h = stage.inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const heading = h ? plainText(h[1]) : `Stage ${id}`;
    // The id is recoverable from "Stage <id> ·…"; a marker only when it is not.
    const derivable = new RegExp(`^Stage\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(heading);
    out.push(`### ${heading}${pr ? ` (PR ${pr})` : ''}`);
    if (!derivable) {
      out.push(`<!-- sf:stage id="${markerValue(id)}"${pr ? ` pr="${markerValue(pr)}"` : ''} -->`);
    }
    out.push('');

    const tasks = [];
    for (const el of nodes(stage.inner)) {
      if (el.kind !== 'el') continue;
      if (el.tag === 'ul' && classes(el.attrs).has('sf-tasks')) {
        for (const t of nodes(el.inner)) {
          if (t.kind !== 'el' || t.tag !== 'li') continue;
          const tid = attr(t.attrs, 'data-sf-task');
          const status = attr(t.attrs, 'data-sf-status') || 'todo';
          const verifyEl = [...nodes(t.inner)].find((x) => x.kind === 'el' && classes(x.attrs).has('verify'));
          const body = verifyEl ? t.inner.replace(/<span\b[^>]*class="verify"[\s\S]*?<\/span>/i, '') : t.inner;
          const text = inline(body, ctx).replace(/\s+/g, ' ').trim();
          tasks.push(`- [${status === 'done' ? 'x' : ' '}] ${tid ? `${tid} ` : ''}${text}`);
          // A checkbox says done or not done. Everything else needs the marker.
          if (status !== 'done' && status !== 'todo') {
            tasks.push(`      <!-- sf:task id="${markerValue(tid)}" status="${markerValue(status)}" -->`);
          }
          if (verifyEl) tasks.push(`      ${inline(verifyEl.inner, ctx).replace(/\s+/g, ' ').trim()}`);
        }
      }
    }
    if (tasks.length) out.push(tasks.join('\n'), '');

    for (const el of nodes(stage.inner)) {
      if (el.kind === 'el' && el.tag === 'p') {
        const t = inline(el.inner, ctx).replace(/\s+/g, ' ').trim();
        if (t) out.push(t, '');
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Lift an `<svg>` into a standalone file and return the image reference.
 * Palette variables do not resolve outside the spec, so the light-theme token
 * values are inlined onto the file's own `:root`.
 */
function liftSvg(el, label, ctx) {
  // Numbered within the section, not across the document, so adding a diagram to
  // section 1 does not renumber every file after it.
  ctx.sectionAssets = (ctx.sectionAssets || 0) + 1;
  // The section id becomes a FILE NAME, so it is reduced to a safe token first.
  // House ids are already kebab-case, but a hand-authored spec can carry anything,
  // and `id="../../x"` would otherwise write outside the assets directory.
  const stem = String(ctx.sectionId).replace(/[^\w-]/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
  const name = `${stem}-${ctx.sectionAssets}.svg`;
  const attrs = el.attrs.replace(/\s*xmlns\s*=\s*"[^"]*"/i, '');
  const style = ctx.tokens ? `<style>:root{${ctx.tokens}}</style>` : '';
  ctx.assets.push({
    name,
    svg: `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${style}${el.inner}</svg>\n`,
  });
  const alt = label || plainText(attr(el.attrs, 'aria-label')) || 'Diagram';
  return [`![${alt}](${ctx.assetsDir}/${name})`, `<!-- sf:svg id="${name.replace(/\.svg$/, '')}" -->`];
}

/** Render one block-level element. Returns an array of markdown blocks. */
function renderBlock(n, ctx, depth = 0) {
  if (n.kind === 'text') {
    const t = escapeText(decodeEntities(n.text).replace(/\s+/g, ' ').trim());
    return t ? [t] : [];
  }
  const { tag, attrs, inner } = n;
  const cls = classes(attrs);

  switch (tag) {
    case 'h2': return [`## ${inline(inner, ctx).trim()}`];
    case 'h3': return [`### ${inline(inner, ctx).trim()}`];
    case 'h4': return [`#### ${inline(inner, ctx).trim()}`];
    case 'h5': case 'h6': return [`##### ${inline(inner, ctx).trim()}`];
    case 'p': {
      // Same rule as the container run below: collapse horizontal whitespace
      // except immediately before a newline, where two spaces are the hard line
      // break a <br> just produced.
      const t = inline(inner, ctx).replace(/[ \t]+(?!\n)/g, ' ').trim();
      return t ? [t] : [];
    }
    case 'ul': case 'ol': {
      if (cls.has('sf-stages')) return [renderPlan(inner, ctx)];
      const block = renderList(inner, ctx, tag === 'ol', 0);
      return block ? [block] : [];
    }
    case 'table': {
      const t = renderTable(inner, ctx);
      return t ? [t] : [];
    }
    case 'pre': return [renderCode(inner, ctx)];
    case 'hr': return ['---'];
    case 'blockquote': return [blockquote(renderChildren(inner, ctx, depth + 1))];
    case 'svg': return liftSvg(n, '', ctx);
    case 'figure': {
      const svg = [...nodes(inner)].find((x) => x.kind === 'el' && x.tag === 'svg');
      const cap = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
      const caption = cap ? plainText(cap[1]) : '';
      if (!svg) return renderChildren(inner, ctx, depth);
      const label = plainText(attr(svg.attrs, 'aria-label')) || caption;
      const out = liftSvg(svg, label, ctx);
      if (caption) out.push(`*${caption}*`);
      return out;
    }
    case 'div': {
      if (cls.has('callout')) {
        const variant = [...CALLOUT_VARIANTS].find((v) => cls.has(v)) || '';
        const body = renderChildren(inner, ctx, depth + 1);
        return [
          ...(variant ? [`<!-- sf:callout variant="${variant}" -->`] : ['<!-- sf:callout -->']),
          blockquote(body),
        ];
      }
      if (cls.has('panel') || cls.has('card')) {
        const kind = cls.has('panel') ? 'panel' : 'card';
        return [`<!-- sf:box class="${kind}" -->`, ...renderChildren(inner, ctx, depth + 1)];
      }
      return renderChildren(inner, ctx, depth);
    }
    case 'section': case 'main': case 'span': case 'figcaption':
      return renderChildren(inner, ctx, depth);
    case 'style': case 'script': case 'nav':
      return [];
    default:
      ctx.warnings.push(`unhandled element <${tag}>, rendered as text`);
      return renderChildren(inner, ctx, depth);
  }
}

// Elements that belong inside a line of prose rather than beside it.
const INLINE_TAGS = new Set([
  'a', 'code', 'kbd', 'samp', 'var', 'em', 'i', 'strong', 'b', 'u', 's', 'span',
  'small', 'sub', 'sup', 'abbr', 'mark', 'time', 'q', 'cite', 'br', 'img',
]);

/**
 * Render a container's children.
 *
 * Consecutive inline nodes are gathered into one paragraph before anything else
 * runs. House markup puts text straight inside a `.callout` or `.card` with an
 * inline `<code>` in the middle of it; walking those as separate blocks emitted
 * the code as bare text and warned about an "unhandled element", which is how
 * this spec's own export lost its backticks.
 */
function renderChildren(html, ctx, depth = 0) {
  const out = [];
  let run = '';
  const flush = () => {
    // Collapse horizontal whitespace, EXCEPT the run immediately before a
    // newline: two spaces there are what make a hard line break in markdown, and
    // collapsing them to one would silently rejoin the lines a <br> split.
    const text = run
      .replace(/[ \t]+(?!\n)/g, ' ')
      .split('\n')
      .map((line) => line.replace(/^ +/, ''))
      .join('\n')
      .trim();
    if (text) out.push(text);
    run = '';
  };

  for (const n of nodes(html)) {
    if (n.kind === 'text' || INLINE_TAGS.has(n.tag)) {
      // Reconstructed to hand back to inline(). A void element gets no closing
      // tag: `<br></br>` leaves the scanner with a `</br>` it cannot parse, and
      // the stray `/br>` lands in the document as text.
      run += n.kind === 'text'
        ? escapeText(decodeEntities(n.text).replace(/\s+/g, ' '))
        : inline(
          VOID.has(n.tag) ? `<${n.tag}${n.attrs}>` : `<${n.tag}${n.attrs}>${n.inner}</${n.tag}>`,
          ctx
        );
      continue;
    }
    flush();
    out.push(...renderBlock(n, ctx, depth));
  }
  flush();
  return out.filter((b) => b !== '');
}

function blockquote(blocks) {
  return blocks
    .join('\n\n')
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
}

// ---------------------------------------------------------------- sections

/** The light-theme palette values, as a CSS declaration list for a lifted SVG. */
function lightTokens(html) {
  const m = html.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/);
  if (!m) return '';
  return m[1]
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.startsWith('--'))
    .join(';');
}

/** The heading a section is titled by, and the markup that produced it. */
function sectionHeading(body) {
  const h2 = body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return { text: plainText(h2[1]), raw: h2[0] };
  const h34 = body.match(/<h([34])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (h34) return { text: plainText(h34[2]), raw: h34[0] };
  return { text: '', raw: '' };
}

/** YAML frontmatter, flat pairs only. Values are quoted when they need to be. */
function frontmatter(fields) {
  const quote = (v) => {
    const s = String(v);
    return /^[\w][\w .\/-]*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
  };
  const body = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${quote(v)}`)
    .join('\n');
  return `---\n${body}\n---`;
}

/**
 * Convert a spec to SF-MD.
 *
 * @param {string} html spec HTML
 * @param {object} [opts]
 * @param {string} [opts.id]        spec id, recorded as provenance
 * @param {string} [opts.type]      spec type, recorded in frontmatter
 * @param {string} [opts.slug]      basename for the file and its assets directory
 * @param {string} [opts.exportedAt] ISO date stamp (callers pass one; there is no clock here)
 * @returns {{markdown:string, assets:{name:string, svg:string}[], warnings:string[], slug:string}}
 */
export function specToMarkdown(html, opts = {}) {
  const title = getTitle(html);
  const name = opts.slug || slug(title) || 'spec';
  const ctx = {
    assets: [],
    warnings: [],
    tokens: lightTokens(html),
    assetsDir: `${name}.assets`,
    sectionId: '',
  };

  const blocks = [
    frontmatter({
      title,
      type: opts.type || '',
      status: getStatus(html),
      specforge_id: opts.id || '',
      exported_at: opts.exportedAt || '',
    }),
    `# ${inline(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || title, ctx).trim()}`,
  ];

  for (const id of getSectionIds(html)) {
    if (DERIVED_SECTIONS.has(id)) continue;
    const body = sectionBody(html, id);
    if (body === null) continue;
    ctx.sectionId = id;
    ctx.sectionAssets = 0;

    const heading = sectionHeading(body);
    const headingText = heading.text || id;
    blocks.push(`## ${headingText}`);
    // The id is the anchor comments hang off. Emit it only when the heading's
    // slug does not reproduce it.
    if (headingSlug(headingText) !== id) blocks.push(`<!-- sf:section id="${markerValue(id)}" -->`);

    const rest = heading.raw ? body.replace(heading.raw, '') : body;
    blocks.push(...renderChildren(rest, ctx));
  }

  const markdown = `${blocks.filter((b) => b && b.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
  return { markdown, assets: ctx.assets, warnings: [...new Set(ctx.warnings)], slug: name };
}

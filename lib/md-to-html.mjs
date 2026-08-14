// SF-MD → spec HTML: the deterministic import pass.
//
// It produces a complete, lint-passing spec with no model in the loop, which is
// what makes import reproducible and testable. The agent pass that follows it
// (the convert-spec skill) improves a valid document instead of authoring one
// from an empty scaffold.
//
// Sections come from the markdown's own `##` headings. Every other type in the
// store carries a house section set the importer would have to invent, which is
// why an imported document is a `general` spec unless the caller says otherwise.

import { parseMarkdown, inlineToHtml, isSafeUrl, isSafeLoadUrl } from './md-parse.mjs';
import { computeTracker, renderTrackerTable } from './tracker.mjs';

const MAX_RASTER_BYTES = 512 * 1024;

/** Escape text for HTML element content. */
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Lowercase kebab, with the display ordinal off the front. */
export function slugify(text) {
  return String(text)
    .replace(/^\s*\d+\s*[·.:)\]-]\s*/, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------- sanitizing

// Elements an imported document may keep: the prose vocabulary a spec uses, plus
// the SVG one, because a diagram is inlined back into the spec on import.
const ALLOWED_TAGS = new Set([
  // prose
  'p', 'br', 'hr', 'span', 'div', 'em', 'i', 'strong', 'b', 'u', 's', 'small', 'sub', 'sup',
  'code', 'kbd', 'samp', 'var', 'pre', 'blockquote', 'q', 'cite', 'abbr', 'mark', 'time',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img', 'figure', 'figcaption', 'details', 'summary', 'section', 'article', 'aside',
  // svg
  'svg', 'g', 'defs', 'symbol', 'use', 'marker', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'clippath', 'mask',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'image',
  // foreignObject is deliberately absent. It switches the parser back into HTML
  // inside SVG, which is the classic mutation-XSS seam, and no diagram SpecForge
  // produces needs one. Unlisted means unwrapped, so a document that has one
  // keeps its content.
]);

// Elements dropped WITH their content. Keeping the text of a <script> would put
// the payload on the page for someone to copy out, and <style> can carry url().
const DROP_WHOLE = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select',
  'textarea', 'base', 'link', 'meta', 'template', 'noscript', 'frame', 'frameset',
  'applet', 'audio', 'video', 'source', 'track', 'canvas', 'math', 'annotation-xml',
]);

// Attributes any allowed element may carry. Everything else goes, which is what
// makes `on*` handlers, `srcdoc`, and whatever the next obscure attribute turns
// out to be a non-event: they are simply not on the list.
const ALLOWED_ATTRS = new Set([
  'class', 'id', 'title', 'alt', 'href', 'src', 'lang', 'dir', 'datetime', 'cite',
  'colspan', 'rowspan', 'scope', 'headers', 'span', 'open',
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
  // svg geometry and paint
  'viewbox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'width', 'height', 'x', 'y', 'dx', 'dy',
  'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'letter-spacing', 'marker-start', 'marker-mid', 'marker-end', 'offset', 'stop-color',
  'stop-opacity', 'gradientunits', 'gradienttransform', 'patternunits', 'preserveaspectratio',
  'clip-path', 'mask', 'refx', 'refy', 'markerwidth', 'markerheight', 'orient', 'overflow',
]);

// Attributes the browser fetches on its own, before anyone clicks anything.
// These get the stricter check: no remote host, because a spec is self-contained
// and can be published, and a remote src is a beacon that fires for every
// reviewer who opens the page.
const LOAD_ATTRS = new Set(['src', 'poster', 'xlink:href']);

// `href` is the exception that needs the element to decide. On an anchor it is a
// navigation the reader chooses; on SVG's <image> and <use> it is SVG2 spelling
// of xlink:href, and the browser fetches it unprompted.
const NAVIGATE_HREF_TAGS = new Set(['a', 'area']);
const NAVIGATE_ATTRS = new Set(['action', 'formaction']);

function isLoadAttr(tag, attr) {
  if (LOAD_ATTRS.has(attr)) return true;
  return attr === 'href' && !NAVIGATE_HREF_TAGS.has(tag);
}

// `data-*` is kept: the plan and section markup rides on data-sf-* attributes,
// and a data attribute cannot execute on its own.
const DATA_ATTR = /^data-[\w-]+$/;

// Attribute names, then optionally a value in any of the three quoting forms.
// Names may be separated by whitespace OR a solidus, which HTML accepts and which
// `<img/onerror=alert(1)>` relies on.
const ATTR = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;

// A tag, with its attribute text captured whole. Quoted values may contain '>'.
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

// isSafeUrl lives in md-parse.mjs, where the inline renderer that builds <a> and
// <img> out of markdown link syntax also needs it. One definition, both paths.
export { isSafeUrl };

/**
 * Remove what must never reach the review page.
 *
 * Imported markdown is not trusted: the daemon stores the result and serves it
 * in a browser, with no second sanitization pass and no content-security policy
 * behind it. Whatever survives this function executes.
 */
/** Rebuild an element's attributes from the allow-list. */
function keepAttrs(tag, attrText) {
  const kept = [];
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(attrText))) {
    // Matched case-insensitively, emitted as written: SVG attribute names are
    // case-sensitive, and lowercasing viewBox is how a diagram stops rendering.
    const name = m[1];
    const lower = name.toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (!ALLOWED_ATTRS.has(lower) && !DATA_ATTR.test(lower)) continue;
    if (value === undefined) { kept.push(name); continue; }
    // A load the browser makes on its own is dropped rather than pointed at '#',
    // which would still be a request. A navigation the reader chooses becomes '#'.
    if (isLoadAttr(tag, lower) && !isSafeLoadUrl(value)) continue;
    const navigational = NAVIGATE_ATTRS.has(lower) || (lower === 'href' && NAVIGATE_HREF_TAGS.has(tag));
    const safe = navigational && !isSafeUrl(value) ? '#' : value;
    // The quote only. These values come from HTML source, where `&amp;` is
    // already an escape; escaping the ampersand again spells it out in the URL.
    kept.push(`${name}="${String(safe).replace(/"/g, '&quot;')}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

/**
 * Remove what must never reach the review page.
 *
 * Imported markdown is not trusted: the daemon stores the result and serves it
 * in a browser, with no second sanitization pass and no content-security policy
 * behind it. Whatever survives this function executes.
 *
 * Elements, attributes and URL schemes are all ALLOW-lists. A block-list was
 * tried first and leaked four times in review — javascript: in quoting forms the
 * pattern did not cover, then entity-encoded, then a solidus standing in for the
 * separator. Each fix closed one spelling of the same idea. An allow-list makes
 * the whole class a non-event: an attribute nobody listed is dropped whatever it
 * is called, so `on*`, `srcdoc` and whatever comes next need no rule of their own.
 */
export function sanitizeHtml(raw) {
  let out = String(raw);

  // Elements dropped with their content, paired tags first so the text between
  // them goes too. Repeated because they nest.
  for (let i = 0; i < 5; i++) {
    const before = out;
    for (const tag of DROP_WHOLE) {
      out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
      out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
    }
    if (out === before) break;
  }

  // Then rebuild every remaining tag from the allow-lists. An unlisted element is
  // unwrapped rather than deleted: its text is content the author wrote, and only
  // the markup around it was unusable.
  return out.replace(TAG, (_match, closing, tag, attrText) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (closing) return `</${name}>`;
    const selfClosing = /\/\s*$/.test(attrText) ? ' /' : '';
    return `<${name}${keepAttrs(name, attrText)}${selfClosing}>`;
  });
}

// ---------------------------------------------------------------- blocks

function renderInlineText(text) {
  return inlineToHtml(text);
}

function renderList(list, ctx) {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items.map((item) => {
    const q = item.blocks.find((b) => b.type === 'marker' && b.name === 'q');
    const state = q ? q.attrs.state : item.checked === null ? null : item.checked ? 'resolved' : 'open';
    const attrs = state ? ` data-sf-q="${escAttr(state)}"` : '';
    const nested = item.blocks.filter((b) => b.type === 'list').map((b) => renderList(b, ctx)).join('');
    const continuation = item.blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => ` ${renderInlineText(b.text)}`)
      .join('');
    return `<li${attrs}>${renderInlineText(item.text)}${continuation}${nested}</li>`;
  });
  return `<${tag}>${items.join('')}</${tag}>`;
}

function renderTable(block) {
  const head = block.header.map((c) => `<th>${renderInlineText(c)}</th>`).join('');
  const rows = block.rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInlineText(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderImage(block, ctx) {
  // Checked before the resolver sees it. `![x](javascript:…)` is not an asset
  // reference at all, and echoing it into the placeholder would put the payload
  // back on the page as text for someone to copy out.
  if (!isSafeUrl(block.src)) {
    ctx.report.assetsDropped.push({ src: block.src, why: 'image URL uses a scheme that is not allowed' });
    return '<p class="sub">[image refused: unsupported URL scheme]</p>';
  }
  const resolved = ctx.resolveAsset ? ctx.resolveAsset(block.src) : { kind: 'missing' };
  if (resolved.kind === 'svg') {
    // Back inline: a spec is a single self-contained file.
    return sanitizeHtml(resolved.text.replace(/<\?xml[\s\S]*?\?>/g, '').trim());
  }
  if (resolved.kind === 'raster') {
    return `<figure><img src="${escAttr(resolved.dataUri)}" alt="${escAttr(block.alt)}"></figure>`;
  }
  if (resolved.kind === 'remote') {
    ctx.report.assetsDropped.push({ src: block.src, why: 'remote image left as a link; a spec cannot inline it and stay self-contained' });
    return `<p class="sub">[remote image: ${esc(block.src)}]</p>`;
  }
  if (resolved.kind === 'outside') {
    ctx.report.assetsDropped.push({ src: block.src, why: 'path resolves outside the directory the markdown came from' });
    return `<p class="sub">[image not read: ${esc(block.src)}]</p>`;
  }
  if (resolved.kind === 'too-large') {
    ctx.report.assetsDropped.push({ src: block.src, why: `${resolved.bytes} bytes exceeds the ${MAX_RASTER_BYTES} byte inline cap` });
    return `<p class="sub">[image not inlined: ${esc(block.src)}]</p>`;
  }
  ctx.report.assetsDropped.push({ src: block.src, why: 'file not found next to the markdown' });
  return `<p class="sub">[missing image: ${esc(block.src)}]</p>`;
}

/** Render a run of blocks that is not the implementation plan. */
function renderBlocks(blocks, ctx) {
  const out = [];
  let pendingCallout = null;
  let pendingBox = null;

  for (const block of blocks) {
    if (block.type === 'marker') {
      if (block.name === 'callout') pendingCallout = block.attrs.variant || '';
      else if (block.name === 'box') pendingBox = block.attrs.class || 'panel';
      // sf:section, sf:svg and sf:task are consumed by their own readers.
      continue;
    }

    let html = '';
    switch (block.type) {
      case 'heading': {
        const level = Math.min(block.level, 6);
        html = `<h${level}>${renderInlineText(block.text)}</h${level}>`;
        break;
      }
      case 'paragraph':
        html = `<p>${renderInlineText(block.text)}</p>`;
        break;
      case 'list':
        html = renderList(block, ctx);
        break;
      case 'table':
        html = renderTable(block);
        break;
      case 'code':
        html = `<pre><code${block.lang ? ` class="lang-${escAttr(block.lang)}"` : ''}>${esc(block.body)}</code></pre>`;
        break;
      case 'quote': {
        const body = renderBlocks(block.blocks, ctx);
        const variant = pendingCallout ? ` ${pendingCallout}` : '';
        html = `<div class="callout${variant}">${body}</div>`;
        pendingCallout = null;
        break;
      }
      case 'image':
        html = renderImage(block, ctx);
        break;
      case 'hr':
        html = '<hr>';
        break;
      case 'html':
        html = sanitizeHtml(block.raw);
        break;
      default:
        html = '';
    }

    if (pendingBox && html) {
      html = `<div class="${escAttr(pendingBox)}">${html}</div>`;
      pendingBox = null;
    }
    if (html) out.push(html);
  }
  return out.join('\n    ');
}

// ---------------------------------------------------------------- the plan

const STATUSES = new Set(['todo', 'in_progress', 'done', 'blocked', 'deferred', 'dropped']);

/** Rebuild `<ol class="sf-stages">` from stage headings and task lists. */
function renderPlan(blocks, ctx) {
  const stages = [];
  let current = null;
  let pendingStageMarker = null;
  const before = [];

  for (const block of blocks) {
    if (block.type === 'marker' && block.name === 'stage') {
      pendingStageMarker = block.attrs;
      continue;
    }
    if (block.type === 'heading' && block.level === 3) {
      const text = block.text.replace(/\s*\(PR\s+([^)]+)\)\s*$/i, '');
      const prFromHeading = (block.text.match(/\(PR\s+([^)]+)\)\s*$/i) || [, ''])[1];
      const idFromHeading = (text.match(/^Stage\s+(\S+?)(?:\s*[·.:-]|\s*$)/i) || [, ''])[1];
      const id = (pendingStageMarker && pendingStageMarker.id) || idFromHeading || String(stages.length);
      const pr = (pendingStageMarker && pendingStageMarker.pr) || prFromHeading || '';
      current = { id, pr, heading: text.trim(), tasks: [], notes: [] };
      stages.push(current);
      pendingStageMarker = null;
      continue;
    }
    if (!current) { before.push(block); continue; }

    if (block.type === 'list' && block.items.some((i) => i.checked !== null)) {
      for (const item of block.items) {
        const marker = item.blocks.find((b) => b.type === 'marker' && b.name === 'task');
        const verifyBlock = item.blocks.find((b) => b.type === 'paragraph' && /^verify:/i.test(b.text));
        const idMatch = /^([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+)\s+(.*)$/.exec(item.text);
        const id = (marker && marker.attrs.id) || (idMatch ? idMatch[1] : `${current.id}.${current.tasks.length + 1}`);
        const text = idMatch ? idMatch[2] : item.text;
        let status = item.checked ? 'done' : 'todo';
        if (marker && STATUSES.has(marker.attrs.status)) status = marker.attrs.status;
        else if (marker && marker.attrs.status) {
          ctx.report.unsupported.push({ line: 0, what: `unknown task status "${marker.attrs.status}" on ${id}` });
        }
        current.tasks.push({
          id,
          status,
          text,
          verify: verifyBlock ? verifyBlock.text.replace(/^verify:\s*/i, '') : '',
        });
      }
      continue;
    }
    if (block.type === 'paragraph') current.notes.push(block.text);
  }

  const html = stages
    .map((s) => {
      const tasks = s.tasks
        .map((t) => {
          const verify = t.verify ? `<span class="verify">verify: ${renderInlineText(t.verify)}</span>` : '';
          return `<li data-sf-task="${escAttr(t.id)}" data-sf-status="${escAttr(t.status)}">${renderInlineText(t.text)}${verify}</li>`;
        })
        .join('');
      const notes = s.notes.map((n) => `<p class="sub">${renderInlineText(n)}</p>`).join('');
      return [
        `<li data-sf-stage="${escAttr(s.id)}" data-sf-pr="${escAttr(s.pr)}">`,
        `<div class="sh"><h3>${renderInlineText(s.heading)}</h3><span class="tag todo">todo</span></div>`,
        tasks ? `<ul class="sf-tasks">${tasks}</ul>` : '',
        notes,
        '</li>',
      ].join('');
    })
    .join('');

  const prefix = before.length ? `${renderBlocks(before, ctx)}\n    ` : '';
  return `${prefix}<ol class="sf-stages">${html}</ol>`;
}

// ---------------------------------------------------------------- sections

/**
 * A section id nothing else has taken. Collisions get -2, -3, so the lint's
 * unique-section-ids check stays green whatever the source document repeated.
 */
function uniqueId(id, used) {
  // Reduced to what an HTML id may be, whatever the marker carried. An id is an
  // anchor the TOC links to and comments hang off; one with slashes or spaces in
  // it breaks its own link, and it has no business being a path either.
  const base = String(id || '').replace(/[^\w-]/g, '-').replace(/^-+|-+$/g, '') || 'section';
  let unique = base;
  let n = 2;
  while (used.has(unique)) unique = `${base}-${n++}`;
  used.add(unique);
  return unique;
}

/**
 * Split parsed blocks into sections, one per `##`.
 * Content before the first `##` becomes the tldr section: a document always has
 * a lead, and dropping it to keep the mapping tidy would lose text.
 */
export function toSections(blocks, ctx) {
  const sections = [];
  const used = new Set();
  let pendingId = null;
  let current = null;

  const open = (heading, id) => {
    current = { id: uniqueId(id, used), heading, blocks: [] };
    sections.push(current);
  };

  for (const block of blocks) {
    if (block.type === 'marker' && block.name === 'section') {
      // The marker sits UNDER its heading, where it is invisible in a renderer
      // and reads as belonging to the section it names. Applying it to the next
      // heading instead would shift every id in the document by one.
      if (current && current.blocks.length === 0) {
        used.delete(current.id);
        current.id = uniqueId(block.attrs.id, used);
      } else {
        pendingId = block.attrs.id;
      }
      continue;
    }
    if (block.type === 'heading' && block.level === 1) continue; // the document title
    if (block.type === 'heading' && block.level === 2) {
      open(block.text, pendingId || slugify(block.text));
      pendingId = null;
      continue;
    }
    if (!current) open('TL;DR', 'tldr');
    current.blocks.push(block);
  }

  return sections.map((s) => ({
    id: s.id,
    heading: s.heading,
    html: s.id === 'impl-plan' ? renderPlan(s.blocks, ctx) : renderBlocks(s.blocks, ctx),
  }));
}

// ---------------------------------------------------------------- the shell

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, '').trim();
}

/** Replace the shell's sections with the imported ones and rebuild the TOC. */
export function composeShell(shell, { title, status, date, owner, sections }) {
  let html = shell
    .replaceAll('{{TITLE}}', esc(title))
    .replaceAll('{{DATE}}', esc(date))
    .replaceAll('{{STATUS}}', esc(status))
    .replaceAll('{{OWNER}}', esc(owner));

  const body = sections
    .map((s) => {
      const heading = `<h2>${renderInlineText(s.heading)}</h2>`;
      return `  <section id="${escAttr(s.id)}" data-sf-section>\n    ${heading}\n    ${s.html}\n  </section>`;
    })
    .join('\n\n');

  // Drop every section the shell shipped, then put the imported ones where the
  // first one stood. Splicing rather than appending keeps the footer last.
  const first = html.search(/<section\b/);
  if (first === -1) throw new Error('composeShell: the shell has no <section> to replace');
  const lastEnd = html.lastIndexOf('</section>') + '</section>'.length;
  html = html.slice(0, first) + body + html.slice(lastEnd);

  const toc = sections
    .map((s) => `  <a href="#${escAttr(s.id)}">${esc(stripTags(s.heading))}</a>`)
    .join('\n');
  html = html.replace(
    /(<nav class="toc">[\s\S]*?<span class="tag-mini">[^<]*<\/span>)[\s\S]*?(<\/nav>)/,
    (_m, head, close) => `${head}\n${toc}\n${close}`
  );

  return html;
}

/** Add or refresh the tracker section from the plan that is already in `html`. */
function withTracker(html, sections) {
  const tracker = renderTrackerTable(computeTracker(html));
  const section = [
    '  <section id="task-tracker" data-sf-section>',
    '    <h2>Task tracker</h2>',
    '    <p class="sub">Projection of <code>data-sf-status</code> across the plan. Rendered live when served.</p>',
    `    ${tracker}`,
    '  </section>',
  ].join('\n');

  if (/<section\b[^>]*id="task-tracker"/.test(html)) {
    return html.replace(/<section\b[^>]*id="task-tracker"[\s\S]*?<\/section>/, section.trim());
  }
  if (!sections.some((s) => s.id === 'impl-plan')) return html;
  return html.replace(/(<section\b[^>]*id="impl-plan"[\s\S]*?<\/section>)/, `$1\n\n${section}`);
}

/**
 * Convert markdown into spec HTML.
 *
 * @param {string} md
 * @param {object} opts
 * @param {string} opts.shell        the per-type template HTML
 * @param {string} [opts.title]      overrides frontmatter and the first h1
 * @param {string} [opts.date]       YYYY-MM-DD stamp for the shell
 * @param {string} [opts.owner]
 * @param {(src:string) => object} [opts.resolveAsset]
 * @returns {{html:string, title:string, status:string, frontmatter:object, report:object}}
 */
export function markdownToSpecHtml(md, opts = {}) {
  const parsed = parseMarkdown(md);
  const ctx = {
    resolveAsset: opts.resolveAsset,
    report: { unsupported: [...parsed.unsupported], assetsDropped: [], sections: 0 },
  };

  const h1 = parsed.blocks.find((b) => b.type === 'heading' && b.level === 1);
  const title = opts.title
    || parsed.frontmatter.title
    || (h1 ? stripTags(inlineToHtml(h1.text)) : '')
    || 'Untitled';
  const status = parsed.frontmatter.status === 'approved' ? 'approved' : 'draft';

  const sections = toSections(parsed.blocks, ctx);
  ctx.report.sections = sections.length;

  let html = composeShell(opts.shell, {
    title,
    status,
    date: opts.date || '',
    owner: opts.owner || '',
    sections,
  });

  html = html.replace(/(<html\b[^>]*\bdata-sf-spec-status=")[^"]*(")/i, `$1${status}$2`);

  // The tracker is a projection of the plan, never parsed from the markdown.
  if (/<section\b[^>]*id="task-tracker"/.test(html) || sections.some((s) => s.id === 'impl-plan')) {
    html = withTracker(html, sections);
  }

  return { html, title, status, frontmatter: parsed.frontmatter, report: ctx.report };
}

export { MAX_RASTER_BYTES };

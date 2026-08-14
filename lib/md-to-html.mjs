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

import { parseMarkdown, inlineToHtml } from './md-parse.mjs';
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

// Schemes a link in an imported document may use. An allow-list and not a
// block-list, because the block-list is the thing an attacker enumerates.
const SAFE_SCHEME = /^(?:https?|mailto|tel|ftp):/i;

// Attributes whose value a browser fetches or navigates to.
const URL_ATTR = /(\s(?:href|src|action|formaction|poster|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Drop the characters a browser ignores inside a URL: C0 controls, space, DEL. */
function stripControl(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/**
 * Decode what a URL can hide its scheme behind. `java&#x73;cript:` and a tab in
 * the middle of `java script:` are both javascript: by the time a browser reads
 * them, so both have to be resolved before the scheme is inspected.
 */
function decodeUrl(value) {
  const decoded = String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&colon;?/gi, ':')
    .replace(/&(?:tab|newline);?/gi, '')
    .replace(/&amp;/gi, '&');
  return stripControl(decoded);
}

// An inline image, which is how a raster survives being imported into a
// self-contained spec. svg+xml is excluded on purpose: SVG carries script, and a
// browser runs it when the URL is navigated to rather than rendered as an image.
const SAFE_DATA = /^data:image\/(?!svg\+xml)[a-z0-9.+-]+;base64,[a-z0-9+/=\s]*$/i;

/** True when a URL is safe to keep: no scheme at all, or one on the allow-list. */
export function isSafeUrl(value) {
  const decoded = decodeUrl(value);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return true; // relative, fragment, //host
  if (SAFE_SCHEME.test(decoded)) return true;
  return SAFE_DATA.test(decoded);
}

/**
 * Remove what must never reach the review page.
 *
 * Imported markdown is not trusted: the daemon stores the result and serves it
 * in a browser, with no second sanitization pass and no content-security policy
 * behind it. Whatever survives this function executes.
 */
export function sanitizeHtml(raw) {
  return String(raw)
    // Elements that execute or embed, with or without a closing tag.
    .replace(/<(script|iframe|object|embed|form|base|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|form|base|link|meta)\b[^>]*\/?>/gi, '')
    // Inline event handlers, in all three quoting forms.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    // srcdoc is a whole document inside an attribute; it has no safe subset.
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Navigable URLs, whatever quoting and escaping they arrived in.
    .replace(URL_ATTR, (match, prefix, dq, sq, uq) => {
      const value = dq !== undefined ? dq : sq !== undefined ? sq : uq;
      if (isSafeUrl(value)) return match;
      const quote = sq !== undefined ? "'" : '"';
      return `${prefix}${quote}#${quote}`;
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
  const base = id || 'section';
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

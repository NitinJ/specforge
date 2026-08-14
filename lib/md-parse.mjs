// A markdown parser for the house subset: enough CommonMark plus GFM to read
// back everything html-to-md.mjs writes, and enough of the rest to take a
// foreign design doc without losing any of it.
//
// In-house because the package ships zero runtime dependencies and a plugin that
// installs into someone's Claude Code should not add a supply-chain surface for
// a mechanical transform. The subset is bounded by what the house templates emit
// (the spec's §5 parser subset); anything outside it is reported with its line
// number and passed through, never dropped silently.
//
// Block types produced:
//   {type:'heading', level, text}          {type:'paragraph', text}
//   {type:'code', lang, body}              {type:'list', ordered, items:[Item]}
//   {type:'table', header, rows}           {type:'quote', blocks}
//   {type:'hr'}                            {type:'html', raw}
//   {type:'marker', name, attrs}           {type:'image', alt, src}
// An Item is {text, checked:boolean|null, blocks:[Block]}, where blocks holds the
// item's nested lists, markers and continuation lines.

/** Parse YAML frontmatter: flat `key: value` pairs only. */
export function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { fields: {}, body: src, unsupported: [] };
  const fields = {};
  const unsupported = [];
  m[1].split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const kv = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      unsupported.push({ line: i + 2, what: 'frontmatter line that is not a flat key: value pair' });
      return;
    }
    let value = kv[2].trim();
    if (value === '' || value === '|' || value === '>' || value === '[' || value === '{') {
      unsupported.push({ line: i + 2, what: `frontmatter value for "${kv[1]}" is not a scalar` });
      return;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    fields[kv[1]] = value;
  });
  return { fields, body: src.slice(m[0].length), unsupported };
}

/** An `<!-- sf:name a="b" -->` marker, or null. */
export function parseMarker(line) {
  const m = /^<!--\s*sf:([\w-]+)([^>]*?)-->\s*$/.exec(line.trim());
  if (!m) return null;
  const attrs = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let a;
  while ((a = re.exec(m[2]))) attrs[a[1]] = a[2];
  return { type: 'marker', name: m[1], attrs };
}

/** Elements with no closing tag: an HTML block opened by one ends on its line. */
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RE = {
  heading: /^(#{1,6})\s+(.*)$/,
  fence: /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
  hr: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
  bullet: /^(\s*)([-*+])\s+(.*)$/,
  ordered: /^(\s*)(\d+)[.)]\s+(.*)$/,
  quote: /^\s*>\s?(.*)$/,
  tableRow: /^\s*\|(.*)\|\s*$/,
  tableRule: /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/,
  htmlOpen: /^\s*<(\/?)([a-zA-Z][\w-]*)/,
  // The URL may contain one level of balanced parentheses, because real ones do:
  // stopping at the first ')' truncates every Wikipedia _(disambiguation) link
  // and leaves the closing bracket behind as text.
  imageOnly: /^\s*!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)\s*$/,
  image: /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
  link: /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
  // Constructs the subset does not cover. Reported, then treated as prose.
  setext: /^\s*(={2,}|-{2,})\s*$/,
  footnote: /^\s*\[\^[^\]]+\]:/,
  refLink: /^\s*\[[^\]]+\]:\s*\S+/,
};

/** Split a GFM table row into cells, respecting escaped pipes. */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i++; continue; }
    if (inner[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += inner[i];
  }
  cells.push(cur.trim());
  return cells;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isBlockStart(line) {
  return (
    RE.heading.test(line) ||
    RE.fence.test(line) ||
    RE.bullet.test(line) ||
    RE.ordered.test(line) ||
    RE.quote.test(line) ||
    RE.hr.test(line) ||
    RE.tableRow.test(line) ||
    /^\s*<!--/.test(line) ||
    RE.htmlOpen.test(line)
  );
}

/**
 * Parse markdown into blocks.
 * @param {string} src
 * @returns {{frontmatter:object, blocks:object[], unsupported:{line:number, what:string}[]}}
 */
export function parseMarkdown(src) {
  const normalized = String(src).replace(/\r\n/g, '\n');
  const { fields, body, unsupported: fmUnsupported } = parseFrontmatter(normalized);
  const offset = normalized.slice(0, normalized.length - body.length).split('\n').length - 1;
  const lines = body.split('\n');
  const unsupported = [...fmUnsupported];
  const blocks = [];
  let i = 0;

  const report = (idx, what) => unsupported.push({ line: offset + idx + 1, what });

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const marker = parseMarker(line);
    if (marker) { blocks.push(marker); i++; continue; }

    // An HTML comment that is not a marker renders as nothing: skip it.
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++;
      continue;
    }

    const fence = RE.fence.exec(line);
    if (fence) {
      const [, indent, ticks, lang] = fence;
      const close = new RegExp(`^\\s*${ticks[0]}{${ticks.length},}\\s*$`);
      const bodyLines = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        bodyLines.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', lang: lang || '', body: bodyLines.join('\n') });
      continue;
    }

    const heading = RE.heading.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableRule.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && RE.tableRow.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // After the table rule, which can look like one.
    if (RE.hr.test(line) && !RE.bullet.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (RE.quote.test(line)) {
      const quoted = [];
      while (i < lines.length && (RE.quote.test(lines[i])
        || (quoted.length && lines[i].trim() && !isBlockStart(lines[i])))) {
        const q = RE.quote.exec(lines[i]);
        quoted.push(q ? q[1] : lines[i]);
        i++;
      }
      const inner = parseMarkdown(quoted.join('\n'));
      unsupported.push(...inner.unsupported);
      blocks.push({ type: 'quote', blocks: inner.blocks });
      continue;
    }

    if (RE.bullet.test(line) || RE.ordered.test(line)) {
      const { list, next } = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    const image = RE.imageOnly.exec(line);
    if (image) {
      blocks.push({ type: 'image', alt: image[1], src: image[2] });
      i++;
      continue;
    }

    // Exclusive: a footnote definition also matches the reference-link shape
    // (`[^1]:` is a `[...]:`), and reporting one line twice reads as two problems.
    if (RE.footnote.test(line)) report(i, 'footnote definition (not supported; kept as text)');
    else if (RE.refLink.test(line)) report(i, 'reference-style link definition (not supported; kept as text)');

    const html = RE.htmlOpen.exec(line);
    if (html && !/^\s*<(?:https?:|[\w.]+@)/.test(line)) {
      const tag = html[2].toLowerCase();
      const close = new RegExp(`</${tag}\\s*>`, 'i');
      // A void element has no closing tag, and a document that never closes the
      // element it opened has none either. Searching on regardless swallowed
      // every following line into one raw block, and the headings after it
      // vanished from the imported spec.
      const ends = VOID.has(tag) || close.test(line) || /\/>\s*$/.test(line)
        ? i
        : lines.findIndex((l, n) => n > i && close.test(l));
      if (ends === -1) {
        report(i, `<${tag}> is never closed; the line was kept as raw HTML on its own`);
        blocks.push({ type: 'html', raw: line });
        i++;
        continue;
      }
      blocks.push({ type: 'html', raw: lines.slice(i, ends + 1).join('\n') });
      i = ends + 1;
      continue;
    }

    // Paragraph: runs to the next blank line or block start.
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      if (RE.setext.test(lines[i])) {
        report(i, 'setext heading (not supported; use # instead)');
        break;
      }
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join('\n').trim() });
  }

  return { frontmatter: fields, blocks, unsupported };
}

/** Parse a list starting at `start`, including nesting and item continuations. */
function parseList(lines, start) {
  const first = RE.bullet.exec(lines[start]) || RE.ordered.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = !RE.bullet.test(lines[start]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the next line is still inside it.
      const next = lines[i + 1];
      if (!next || !next.trim() || indentOf(next) < baseIndent) break;
      i++;
      continue;
    }
    const m = RE.bullet.exec(line) || RE.ordered.exec(line);
    if (!m || m[1].length < baseIndent) break;

    // A change of marker kind at the same indent ends this list and starts a new
    // one. Without this, "1. first" following a bullet list joins it, and an
    // ordered list silently becomes three more bullets.
    if (m[1].length === baseIndent && RE.bullet.test(line) === ordered) break;

    if (m[1].length > baseIndent) {
      const nested = parseList(lines, i);
      if (items.length) items[items.length - 1].blocks.push(nested.list);
      else items.push({ text: '', checked: null, blocks: [nested.list] });
      i = nested.next;
      continue;
    }

    // A task-list checkbox is the status; a marker after it refines the status.
    const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
    const item = {
      text: task ? task[2] : m[3],
      checked: task ? task[1].toLowerCase() === 'x' : null,
      blocks: [],
    };
    // A marker at the end of the item's own line belongs to the item, not to its
    // prose. Left in place it would render as visible text on the way back.
    const trailing = /\s*(<!--\s*sf:[\s\S]*?-->)\s*$/.exec(item.text);
    if (trailing) {
      const marker = parseMarker(trailing[1]);
      if (marker) {
        item.text = item.text.slice(0, trailing.index).trimEnd();
        item.blocks.push(marker);
      }
    }
    items.push(item);
    i++;

    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      const isItem = RE.bullet.exec(l) || RE.ordered.exec(l);
      if (isItem && isItem[1].length <= baseIndent) break;
      if (isItem && isItem[1].length > baseIndent) {
        const nested = parseList(lines, i);
        item.blocks.push(nested.list);
        i = nested.next;
        continue;
      }
      if (indentOf(l) <= baseIndent) break;
      const marker = parseMarker(l);
      item.blocks.push(marker || { type: 'paragraph', text: l.trim() });
      i++;
    }
  }

  return { list: { type: 'list', ordered, items }, next: i };
}

// ---------------------------------------------------------------- inline

/** Escape text for HTML element content. */
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// URL safety lives here, at the bottom of the import stack, because BOTH callers
// need it: md-to-html sanitizes raw HTML blocks, and inlineToHtml below builds
// <a> and <img> straight out of markdown link syntax. Guarding only the raw-HTML
// path would leave `[x](javascript:alert(1))` — ordinary markdown — untouched.

/** Schemes a link in an imported document may use. An allow-list, on purpose. */
const SAFE_SCHEME = /^(?:https?|mailto|tel|ftp):/i;

// An inline image, which is how a raster survives import into a self-contained
// spec. svg+xml is excluded: SVG carries script, and a browser runs it when the
// URL is navigated to rather than rendered as an image.
const SAFE_DATA = /^data:image\/(?!svg\+xml)[a-z0-9.+-]+;base64,[a-z0-9+/=\s]*$/i;

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
 * them, so both are resolved before the scheme is inspected.
 */
function decodeUrl(value) {
  // Repeated until stable, because the escapes nest: markdown text is HTML
  // escaped before the link is built, so `java&#x73;cript:` reaches here as
  // `java&amp;#x73;cript:` and one pass leaves the numeric entity intact. Three
  // rounds is past any real depth; stopping early on a fixed point keeps it cheap.
  let out = String(value);
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);?/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&colon;?/gi, ':')
      .replace(/&(?:tab|newline);?/gi, '')
      .replace(/&amp;/gi, '&');
    if (next === out) break;
    out = next;
  }
  return stripControl(out);
}

/** True when a URL is safe to keep: no scheme at all, or one on the allow-list. */
export function isSafeUrl(value) {
  const decoded = decodeUrl(value);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return true; // relative, fragment, //host
  if (SAFE_SCHEME.test(decoded)) return true;
  return SAFE_DATA.test(decoded);
}

/** A URL safe to put in an attribute, or '#'. */
function safeHref(value) {
  return isSafeUrl(value) ? value : '#';
}

// Code spans are lifted out before anything else runs, so their contents are
// never re-parsed as emphasis or a link: `a *b* c` is code, not code with an
// italic inside.
//
// The placeholder is delimited by U+0000, which cannot occur in a spec. A bare
// numeric placeholder would not do: " 3 " occurs in ordinary prose, and putting
// the spans back would rewrite the sentence around it. Built with fromCharCode
// rather than written as a literal, because a raw NUL byte in the source makes
// grep treat this file as binary and refuse to match anything in it.
const HOLE = String.fromCharCode(0);

/**
 * Render inline markdown to HTML.
 * @param {string} md
 * @returns {string}
 */
export function inlineToHtml(md) {
  const spans = [];
  let s = String(md).replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code) => {
    spans.push(`<code>${esc(code.replace(/^ | $/g, ''))}</code>`);
    return `${HOLE}${spans.length - 1}${HOLE}`;
  });

  s = esc(s);
  // Both go through safeHref: markdown link syntax is not a safer input than a
  // raw HTML block, and the daemon serves what is stored without a second pass.
  s = s.replace(RE.image, (_m, alt, src) => `<img src="${safeHref(src)}" alt="${alt}">`);
  s = s.replace(RE.link, (_m, text, href) => `<a href="${safeHref(href)}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  // Undo the backslash escapes the exporter writes.
  s = s.replace(/\\([\\`*_[\]#>+.-])/g, '$1');

  return s.replace(new RegExp(`${HOLE}(\\d+)${HOLE}`, 'g'), (_m, n) => spans[Number(n)]);
}

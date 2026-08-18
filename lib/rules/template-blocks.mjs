// Reading rules and prompts out of a template, and taking them back out of the
// spec made from it.
//
// A template carries two things and they run at opposite ends of authoring.
// Rules (`<section data-sf-rules>`) are checked after the spec is written.
// Prompts (`<div data-sf-prompt>` inside a section) are read before the section
// is written, and shape it. Neither reaches a spec: the scaffolder strips both,
// and `cmdCreate` hands the prompts to the agent on the way past.
//
// They sit in different places because they are read at different times. A rule
// is about the whole document, so it lives in one block. A prompt is about one
// section, so it lives in that section.

import { SEVERITIES } from './index.mjs';

const RULES_OPEN_RE = /<section\b[^>]*\bdata-sf-rules\b[^>]*>/gi;
const PROMPT_OPEN_RE = /<div\b[^>]*\bdata-sf-prompt\b[^>]*>/gi;
const SECTION_OPEN_RE = /<section\b[^>]*>/gi;

/**
 * The index just past the tag that closes the element opened at `from`.
 *
 * Depth-counted rather than matched with a non-greedy regex. These blocks are
 * prose you edit in SpecForge, so a prompt can perfectly well end up holding a
 * <div>, and a non-greedy `</div>` cuts at the first one: the strip would then
 * remove half the prompt and leave a stray closing tag in the finished spec.
 * Malformed HTML in a shipped document is worse than the scaffolding it was
 * trying to remove.
 *
 * @returns {number} the index after the closing tag, or -1 when it never closes
 */
function endOfElement(html, from, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Remove every element whose opening tag matches `openRe`, nesting included.
 *
 * `eat` says which side's whitespace goes with the block, and it is not
 * cosmetic: render and strip have to be exact inverses, because a scaffolded
 * spec must match its template byte for byte. The rules block is appended, so it
 * takes the whitespace after it; a prompt is inserted at the top of a section,
 * so it takes the whitespace before it.
 *
 * An element that never closes is left alone. Truncating the document at an
 * unbalanced tag would turn one bad edit into a lost spec.
 */
function removeElements(html, openRe, tag, eat) {
  const re = new RegExp(openRe.source, 'gi');
  let out = '';
  let cursor = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index < cursor) continue;
    const end = endOfElement(html, m.index + m[0].length, tag);
    if (end === -1) continue;
    let start = m.index;
    let stop = end;
    if (eat === 'before') while (start > cursor && /\s/.test(html[start - 1])) start--;
    if (eat === 'after') while (stop < html.length && /\s/.test(html[stop])) stop++;
    out += html.slice(cursor, start);
    cursor = stop;
    re.lastIndex = end;
  }
  return out + html.slice(cursor);
}

/** Every element whose opening tag matches `openRe`, as full outer HTML. */
function findElements(html, openRe, tag) {
  const re = new RegExp(openRe.source, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const end = endOfElement(html, m.index + m[0].length, tag);
    if (end === -1) continue;
    out.push({ start: m.index, end, html: html.slice(m.index, end) });
    re.lastIndex = end;
  }
  return out;
}

/** Collapse markup and whitespace to the sentence a human wrote. */
function textOf(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a template's `<section data-sf-rules>` into raw override records.
 *
 * Raw, not full rule records: an override supplies only what it changes, and the
 * common one carries an id and a severity. `mergeRules` fills the rest in from
 * the global list.
 *
 * @param {string} html a template spec's HTML
 * @returns {{id:string, severity?:string, ask?:string}[]}
 */
export function parseTemplateRules(html) {
  const [block] = findElements(String(html), RULES_OPEN_RE, 'section');
  if (!block) return [];
  const out = [];
  const liRe = /<li\b([^>]*\bdata-sf-rule="[^"]*"[^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(block.html))) {
    const id = (m[1].match(/\bdata-sf-rule="([^"]*)"/) || [, ''])[1].trim();
    if (!id) continue;
    const severity = (m[1].match(/\bdata-sf-severity="([^"]*)"/) || [, ''])[1].trim();
    // The fix hint comes out as its own field: it is what to do when the rule
    // fails, and the report prints it separately from the rule. The corpus
    // citation is deliberately left inline instead — an agent judging the rule
    // is helped by the example that produced it, and a second field for it would
    // be one nothing else reads.
    // Marked with a data attribute rather than a class: `fix` is not in the
    // component library, and a template spec is a spec, so a class outside the
    // library makes every template fail its own components lint.
    const body = m[2];
    const fix = textOf((body.match(/<span\b[^>]*\bdata-sf-fix\b[^>]*>([\s\S]*?)<\/span>/i) || [, ''])[1]);
    const ask = textOf(body.replace(/<span\b[^>]*\bdata-sf-fix\b[^>]*>[\s\S]*?<\/span>/gi, ' '));
    const rule = { id };
    if (severity) {
      if (!SEVERITIES.includes(severity)) {
        throw new Error(`template rule ${id}: unknown severity ${JSON.stringify(severity)}`);
      }
      rule.severity = severity;
    }
    if (ask) rule.ask = ask;
    if (fix) rule.fix = fix;
    out.push(rule);
  }
  return out;
}

/**
 * Parse every `<div data-sf-prompt>` out of a template, keyed by the section it
 * sits in.
 *
 * The section id is read from the enclosing `<section>` rather than from an
 * attribute on the prompt, so a prompt cannot drift from the section it governs.
 *
 * @returns {{section:string, text:string}[]}
 */
export function parseTemplatePrompts(html) {
  const out = [];
  for (const sec of findElements(String(html), SECTION_OPEN_RE, 'section')) {
    const open = sec.html.slice(0, sec.html.indexOf('>') + 1);
    const id = (open.match(/\bid="([^"]+)"/) || [, null])[1];
    const inner = sec.html.slice(open.length).replace(/<\/section\s*>$/i, '');
    // The nested sections come out before the prompts are counted, then are
    // walked in their own right. A non-greedy scan cut at the first closing tag
    // instead, so a prompt written for a nested section reached the agent
    // labelled with the enclosing one.
    const own = removeElements(inner, SECTION_OPEN_RE, 'section', 'before');
    for (const p of findElements(own, PROMPT_OPEN_RE, 'div')) {
      const text = textOf(p.html);
      if (text) out.push({ section: id || '(unnamed)', text });
    }
    out.push(...parseTemplatePrompts(inner));
  }
  return out;
}

/**
 * A template's section outline: what a prompt could be attached to.
 *
 * The other two parsers answer "what is written down"; this one answers "what
 * could be". The configuration pane needs the second, because a Sections tab
 * that listed only sections already carrying a prompt would be a list you cannot
 * add to.
 *
 * Sections are read with the depth-counted scan rather than a non-greedy regex,
 * so a section holding another one reports as itself and not as two halves, and
 * the scan then recurses: `renderTemplateBlocks` writes into any section by id,
 * so a nested section is a target in its own right. A parent claims only the
 * headings that are its own, because a heading inside a child belongs to the
 * child and clicking it must not save guidance under the parent's id.
 *
 * The rules block is excluded: it is a section with a heading, so nothing but an
 * explicit exclusion keeps scaffolding out of a list of authoring targets.
 *
 * @param {string} html a template spec's HTML
 * @param {number} [depth] nesting level, for a tree that shows which owns which
 * @returns {{id:string|null, heading:string, level:number, depth:number,
 *            subheadings:{text:string, level:number}[]}[]}
 */
export function parseTemplateOutline(html, depth = 0) {
  const out = [];
  for (const sec of findElements(String(html), SECTION_OPEN_RE, 'section')) {
    const open = sec.html.slice(0, sec.html.indexOf('>') + 1);
    if (/\bdata-sf-rules\b/i.test(open)) continue;
    const id = (open.match(/\bid="([^"]+)"/) || [, null])[1];
    const inner = sec.html.slice(open.length).replace(/<\/section\s*>$/i, '');
    // Prompts hold prose, not headings, but stripping them first means a future
    // prompt with a heading in it cannot appear in the document's outline.
    const own = removeElements(
      removeElements(inner, PROMPT_OPEN_RE, 'div', 'before'),
      SECTION_OPEN_RE, 'section', 'before',
    );
    const heads = [...own.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((h) => ({ text: textOf(h[2]), level: Number(h[1][1]) }))
      .filter((h) => h.text);
    const [first, ...rest] = heads;
    out.push({
      id,
      heading: first ? first.text : (id || ''),
      level: first ? first.level : 2,
      depth,
      subheadings: rest,
    });
    out.push(...parseTemplateOutline(inner, depth + 1));
  }
  return out;
}

/**
 * Remove the rules block and every prompt on the way from template to spec.
 *
 * Idempotent, so importing an HTML file that happens to contain either is also
 * safe. Nothing else in the document is touched: the rest of a scaffolded spec
 * must match the template it came from byte for byte.
 */
export function stripTemplateBlocks(html) {
  const withoutRules = removeElements(String(html), RULES_OPEN_RE, 'section', 'after');
  return removeElements(withoutRules, PROMPT_OPEN_RE, 'div', 'before');
}

/** True when the HTML still carries either block. Used by tests and by strip. */
export function hasTemplateBlocks(html) {
  return /data-sf-rules|data-sf-prompt/i.test(String(html));
}

/**
 * Render a rules block and the prompts into a shell, for seeding a store
 * template.
 *
 * The rules block is appended before `</body>` and marked `hidden`; the review
 * layer drops the attribute for this section, so you see and comment on it like
 * any other block while editing the template. Without that it would be a block
 * you can only edit by knowing it is there.
 *
 * Each prompt is inserted at the top of the section it names. A prompt for a
 * section the shell does not have is skipped rather than dropped somewhere
 * arbitrary.
 *
 * @param {string} shell
 * @param {{rules?:object[], prompts?:Record<string,string>}} o
 */
export function renderTemplateBlocks(shell, { rules = [], prompts = {} } = {}) {
  let html = String(shell);

  for (const [sectionId, text] of Object.entries(prompts)) {
    const openRe = new RegExp(`(<section\\b[^>]*\\bid="${sectionId}"[^>]*>)`, 'i');
    if (!openRe.test(html)) continue;
    const body = text
      .split('\n\n')
      .map((p) => `    <p>${escapeHtml(p.trim())}</p>`)
      .join('\n');
    html = html.replace(openRe, `$1\n  <div data-sf-prompt>\n${body}\n  </div>`);
  }

  if (rules.length) {
    const items = rules.map((r) => {
      const sev = r.severity ? ` data-sf-severity="${r.severity}"` : '';
      const body = r.ask ? escapeHtml(r.ask) : '';
      const fix = r.fix ? ` <span data-sf-fix>${escapeHtml(r.fix)}</span>` : '';
      const cite = r.corpus ? `\n      <span class="evidence">${escapeHtml(r.corpus)}</span>` : '';
      return `    <li data-sf-rule="${r.id}"${sev}>${body}${fix}${cite}</li>`;
    }).join('\n');
    const block = `<section data-sf-rules hidden>\n  <h2>Rules for this spec type</h2>\n  <ul>\n${items}\n  </ul>\n</section>\n`;
    html = html.includes('</body>') ? html.replace('</body>', `${block}</body>`) : html + block;
  }

  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

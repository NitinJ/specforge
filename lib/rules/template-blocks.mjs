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

// The whitespace each pattern eats is the side the renderer adds it on, so that
// render and strip are exact inverses. A scaffolded spec has to match its
// template byte for byte, and a strip that leaves an orphaned newline behind
// makes every spec differ from its template for a reason nobody chose.
// The rules block is appended (whitespace after it), a prompt is inserted at the
// top of a section (whitespace before it).
const RULES_SECTION_RE = /<section\b[^>]*\bdata-sf-rules\b[^>]*>[\s\S]*?<\/section>\s*/gi;
const PROMPT_BLOCK_RE = /\s*<div\b[^>]*\bdata-sf-prompt\b[^>]*>[\s\S]*?<\/div>/gi;

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
  const block = String(html).match(/<section\b[^>]*\bdata-sf-rules\b[^>]*>([\s\S]*?)<\/section>/i);
  if (!block) return [];
  const out = [];
  const liRe = /<li\b([^>]*\bdata-sf-rule="[^"]*"[^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(block[1]))) {
    const id = (m[1].match(/\bdata-sf-rule="([^"]*)"/) || [, ''])[1].trim();
    if (!id) continue;
    const severity = (m[1].match(/\bdata-sf-severity="([^"]*)"/) || [, ''])[1].trim();
    const ask = textOf(m[2]);
    const rule = { id };
    if (severity) {
      if (!SEVERITIES.includes(severity)) {
        throw new Error(`template rule ${id}: unknown severity ${JSON.stringify(severity)}`);
      }
      rule.severity = severity;
    }
    if (ask) rule.ask = ask;
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
  const sectionRe = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let s;
  while ((s = sectionRe.exec(String(html)))) {
    const id = (s[1].match(/\bid="([^"]+)"/) || [, null])[1];
    const prompts = s[2].match(PROMPT_BLOCK_RE);
    if (!prompts) continue;
    for (const p of prompts) {
      const text = textOf(p);
      if (text) out.push({ section: id || '(unnamed)', text });
    }
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
  return String(html)
    .replace(RULES_SECTION_RE, '')
    .replace(PROMPT_BLOCK_RE, '');
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
      const cite = r.corpus ? `\n      <span class="evidence">${escapeHtml(r.corpus)}</span>` : '';
      return `    <li data-sf-rule="${r.id}"${sev}>${body}${cite}</li>`;
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

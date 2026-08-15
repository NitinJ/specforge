// Spec HTML built to fail exactly one rule.
//
// A rule test is only worth anything if the document it runs against fails for
// the reason the test names. Hand-written fixtures drift towards failing for
// three reasons at once, and then a rule that stopped working still looks green
// because some other defect kept the verdict red. So there is one clean spec
// here that every rule passes, and each defect is a named, minimal edit to it.
//
// Usage:
//   cleanSpec()                  // passes every rule
//   specWith('no-placeholders')  // fails that rule and no other
//   DEFECT_IDS                   // every defect name, for table-driven tests

import { PALETTE_TOKENS } from '../../lib/config.mjs';

/** The theme + palette block a spec must carry to satisfy the theme rules. */
function styleBlock() {
  const tokens = PALETTE_TOKENS.map((t) => `--${t}:#888`).join(';');
  return `<style>
:root{${tokens}}
[data-theme="light"]{${tokens}}
@media (prefers-color-scheme: light){:root{${tokens}}}
</style>`;
}

/**
 * A spec every rule passes.
 *
 * Deliberately small: a fixture large enough to be realistic is large enough to
 * hide a second defect. Each section holds one paragraph of real prose, which is
 * the minimum that satisfies both no-empty-sections and section-is-more-than-a-stub.
 *
 * @param {{sections?:{id:string,title:string,body:string}[], toc?:boolean,
 *          title?:string, status?:string, owner?:string, date?:string}} [o]
 */
export function cleanSpec(o = {}) {
  const sections = o.sections || [
    {
      id: 'tldr',
      title: 'TL;DR',
      body: '<p>The store writes one file per spec, so a failed write loses one spec rather than the index.</p>',
    },
    {
      id: 'design',
      title: 'Design',
      body: '<p>Specs are parsed with regular expressions because SpecForge owns the format and ships no runtime dependencies.</p>',
    },
  ];
  const toc = o.toc === false
    ? ''
    : `<nav class="toc">${sections.map((s) => `<a href="#${s.id}">${s.title}</a>`).join('')}</nav>`;
  const title = o.title === null ? '' : `<h1>${o.title || 'A Real Spec'}</h1>`;
  const status = o.status === null ? '' : ` data-sf-spec-status="${o.status || 'draft'}"`;
  const owner = o.owner === undefined ? 'nitin' : o.owner;
  const date = o.date === undefined ? '2026-08-15' : o.date;

  return `<!doctype html><html><head><title>${o.title || 'A Real Spec'}</title>
${styleBlock()}
</head><body${status}>
${title}
<p class="meta">Owner: ${owner} · Date: ${date}</p>
${toc}
${sections.map((s) => `<section id="${s.id}"><h2>${s.title}</h2>${s.body}</section>`).join('\n')}
</body></html>`;
}

/**
 * One defect each, as a function from the clean spec to a spec that fails
 * exactly the rule named by the key.
 *
 * Every builder edits the clean spec rather than writing its own document, so a
 * change to the clean spec propagates and a fixture cannot silently stop being
 * minimal.
 */
export const DEFECTS = {
  'no-placeholders': (html) => html.replace('<h1>A Real Spec</h1>', '<h1>{{TITLE}}</h1>'),

  'no-empty-sections': (html) =>
    html.replace(
      '<section id="design"><h2>Design</h2>',
      '<section id="hollow"><h2>Hollow</h2></section>\n<section id="design"><h2>Design</h2>',
    ).replace('<a href="#design">Design</a>', '<a href="#hollow">Hollow</a><a href="#design">Design</a>'),

  // Both directions of the TOC contract fail the same rule; this is the stale
  // link half, which is the one that survives a section rename.
  'toc-in-sync': (html) => html.replace('<a href="#design">Design</a>', '<a href="#gone">Design</a>'),

  'front-matter-filled': (html) => html.replace('Owner: nitin', 'Owner: {{OWNER}}'),

  'internal-links-resolve': (html) =>
    html.replace(
      '</section>\n</body>',
      '<p>See <a href="#nowhere">the section that is not here</a>.</p></section>\n</body>',
    ),

  'references-are-links': (html) =>
    html.replace(
      'ships no runtime dependencies.',
      'ships no runtime dependencies. The parser lives in lib/spec.mjs.',
    ),

  'has-title': (html) => html.replace('<h1>A Real Spec</h1>', '').replace(/<title>[^<]*<\/title>/, ''),

  'has-status': (html) => html.replace(/ data-sf-spec-status="[^"]*"/, ''),

  'unique-section-ids': (html) => html.replace('<section id="design">', '<section id="tldr">'),

  'theme-contract': (html) => html.replace(/@media \(prefers-color-scheme: light\)\{[^}]*\}\}/, ''),

  'palette-tokens': (html) => html.replace(/--accent:#888;?/g, ''),
};

export const DEFECT_IDS = Object.keys(DEFECTS);

/**
 * The clean spec with exactly one defect applied.
 * @param {string} defect a key of DEFECTS
 */
export function specWith(defect, o = {}) {
  const build = DEFECTS[defect];
  if (!build) throw new Error(`unknown defect: ${defect}`);
  const html = build(cleanSpec(o));
  if (html === cleanSpec(o)) throw new Error(`defect ${defect} did not change the spec`);
  return html;
}

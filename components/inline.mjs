// Inline components: things that sit inside a sentence.
//
// Two of the seven are HTML elements rather than classes (`code`, `kbd`). They
// are in the inventory because an author choosing how to mark something needs to
// find them here, and because leaving them out would make the library look like
// it has no answer for an identifier or a keypress.

export const inline = [
  {
    name: 'tag', family: 'inline', kind: 'class', block: false,
    rule: 'Labelling a state or category inside a table cell, a heading, or a list item.',
    requires: [],
    // `ok` is deliberately absent: it duplicated `good` across 67 uses in the
    // store, and two words for one state is how a vocabulary starts drifting.
    variants: ['accent', 'good', 'warn', 'bad', 'todo', 'done'],
    css: `.tag{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;
  border:1px solid var(--line);background:var(--panel);vertical-align:middle;line-height:1.5}
.tag.accent{color:var(--accent)}
.tag.good{color:var(--green)}
.tag.warn{color:var(--amber)}
.tag.bad{color:var(--red)}
.tag.todo{color:var(--muted)}
.tag.done{color:var(--green)}`,
    example: '<span class="tag good">chosen</span>',
  },
  {
    name: 'kw', family: 'inline', kind: 'class', block: false,
    rule: 'A normative keyword in a requirement, so a reader can tell a rule from a suggestion.',
    requires: ['one of MUST, MUST NOT, SHOULD, SHOULD NOT, MAY'],
    css: `.kw{font-family:var(--mono);font-size:.82em;font-weight:700;letter-spacing:.04em;
  color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);
  border-radius:4px;padding:.1em .4em;white-space:nowrap}`,
    example: 'A component <span class="kw">MUST</span> carry a type.',
  },
  {
    name: 'term', family: 'inline', kind: 'class', block: false,
    rule: 'First use of a term the spec defines. Defined once, referenced thereafter.',
    requires: ['a title attribute carrying the definition'],
    css: '.term{border-bottom:1px dashed var(--muted);cursor:help}',
    example: '<span class="term" title="A spec\'s generated component stylesheet.">stamped block</span>',
  },
  {
    name: 'footnote', family: 'inline', kind: 'class', block: false,
    rule: 'An aside that would interrupt the sentence carrying it.',
    requires: [],
    css: '.footnote{color:var(--muted);font-size:12.5px}',
    example: '<p class="footnote">Authored with SpecForge</p>',
  },
  {
    name: 'src', family: 'inline', kind: 'class', block: false,
    rule: 'Attribution for a measured or cited value. Satisfies the language contract’s source sentence.',
    requires: ['the source', 'a retrieval date'],
    css: `.src{color:var(--muted);font-size:12px;white-space:nowrap}
.src::before{content:"source: "}`,
    example: '<span class="src">audit-specforge-callouts.mjs, 2026-08-14</span>',
  },
  {
    name: 'code', family: 'inline', kind: 'element', block: false,
    rule: 'An identifier, path, flag, or literal value. Never used for emphasis.',
    requires: [],
    example: '<code>lib/config.mjs</code>',
  },
  {
    name: 'kbd', family: 'inline', kind: 'element', block: false,
    rule: 'A key the reader presses.',
    requires: [],
    example: '<kbd>Ctrl</kbd>',
  },
];

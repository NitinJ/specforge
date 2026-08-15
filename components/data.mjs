// Data components: the shapes a spec uses to carry numbers and comparisons.
//
// The threshold in the table rule is load-bearing. Two items compared on one
// attribute is a sentence; making it a table costs a reader more than it saves.

export const data = [
  {
    name: 'table', family: 'data', kind: 'element', block: true,
    rule: 'Three or more items compared on two or more attributes. Fewer is a sentence.',
    requires: ['a thead'],
    example: '<table><thead><tr><th>Option</th><th>Cost</th></tr></thead><tbody><tr><td>A</td><td>8 KB</td></tr></tbody></table>',
  },
  {
    name: 'compare', family: 'data', kind: 'class', block: true,
    rule: 'Options weighed against each other, where the point of the table is the verdict.',
    requires: ['a final verdict column carrying a tag'],
    css: '.compare td:last-child{white-space:nowrap}',
    example: '<table class="compare"><thead><tr><th>Option</th><th>Verdict</th></tr></thead><tbody><tr><td>A</td><td><span class="tag good">chosen</span></td></tr></tbody></table>',
  },
  {
    name: 'stat', family: 'data', kind: 'class', block: true,
    rule: 'Three to six headline numbers a reader should absorb before the prose.',
    requires: ['a number', 'a unit', 'a label'],
    variants: ['stats', 'n', 'k'],
    css: `.stats{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0}
.stat{flex:1 1 150px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat .n{display:block;font-size:22px;font-weight:700;line-height:1.2}
.stat .k{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}`,
    example: '<div class="stats"><div class="stat"><span class="n">669</span><span class="k">classes in use</span></div></div>',
  },
  {
    name: 'dl', family: 'data', kind: 'element', block: true,
    rule: 'Terms with definitions, where the term is the thing being looked up. Preferred over a two-column table for a glossary.',
    requires: [],
    css: `dl{margin:14px 0}
dl dt{font-weight:650;margin-top:10px}
dl dd{margin:2px 0 0 0;padding-left:14px;border-left:2px solid var(--line);color:var(--muted)}`,
    example: '<dl><dt>Stamped block</dt><dd>The generated component CSS between the markers.</dd></dl>',
  },
];

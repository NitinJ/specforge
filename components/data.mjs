// Data components: the shapes a spec uses to carry numbers and comparisons.
//
// The threshold in the table rule is load-bearing. Two items compared on one
// attribute is a sentence; making it a table costs a reader more than it saves.
//
// The number is the accent in this family, because a number is what a reader
// came to the block for. The label under it, the unit beside it and the method
// below it are all muted: they qualify the number, and a qualifier drawn as
// loudly as the thing it qualifies is not a qualifier.
//
// `table` carried no CSS until this file took it. All five shells defined the
// table themselves, after the stamped block, so the library named a component it
// did not style and five copies drifted independently.

export const data = [
  {
    name: 'table', family: 'data', kind: 'element', block: true,
    rule: 'Three or more items compared on two or more attributes. Fewer is a sentence.',
    requires: ['a thead'],
    // The header row is the only tinted surface in the family, and it earns it:
    // a wide table is read by column, and a header that shares the page's
    // background gives a reader scrolling past it nothing to come back to. The
    // zebra is mixed into `transparent` rather than into a surface token so it
    // holds over a panel, a card, or the page.
    css: `table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
th,td{text-align:left;padding:9px 12px;border:1px solid var(--line);vertical-align:top}
th{background:color-mix(in srgb,var(--accent) 12%,var(--panel2));font-weight:650;
  border-bottom:2px solid color-mix(in srgb,var(--accent) 45%,var(--line))}
tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--ink) 3.5%,transparent)}`,
    example: '<table><thead><tr><th>Option</th><th>Cost</th></tr></thead><tbody><tr><td>A</td><td>8 KB</td></tr><tr><td>B</td><td>31 KB</td></tr><tr><td>C</td><td>4 KB</td></tr></tbody></table>',
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
.stat{flex:1 1 150px;background:color-mix(in srgb,var(--accent) 5%,var(--panel2));
  border:1px solid var(--line);border-top:2px solid var(--accent);
  border-radius:10px;padding:12px 14px}
.stat .n{display:block;font-size:22px;font-weight:700;line-height:1.2;color:var(--accent)}
.stat .k{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}`,
    example: '<div class="stats"><div class="stat"><span class="n">669</span><span class="k">classes in use</span></div><div class="stat"><span class="n">39</span><span class="k">components</span></div><div class="stat"><span class="n">8</span><span class="k">themes</span></div></div>',
  },
  {
    name: 'dl', family: 'data', kind: 'element', block: true,
    rule: 'Terms with definitions, where the term is the thing being looked up. Preferred over a two-column table for a glossary.',
    requires: [],
    css: `dl{margin:14px 0}
dl dt{font-weight:650;margin-top:10px;color:var(--accent)}
dl dd{margin:2px 0 0 0;padding-left:14px;color:var(--muted);
  border-left:2px solid color-mix(in srgb,var(--accent) 30%,var(--line))}`,
    example: '<dl><dt>Stamped block</dt><dd>The generated component CSS between the markers.</dd></dl>',
  },
];

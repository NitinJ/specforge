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
    // A variant on `table`, not a second table component. Notion and Confluence
    // both attach ordering to the table rather than introducing a block, and a
    // second table component would split the vocabulary an author chooses from.
    //
    // The authored order stays canonical: sorting is a view a reader asks for,
    // never a change to the document. Export and the un-enhanced page both show
    // what the author wrote, which is why sorting can be offered at all.
    name: 'sortable', family: 'data', kind: 'class', block: true,
    selector: 'table.sortable',
    layer: 'interactive', needs: 'script', detect: 'table.sortable',
    rule: 'A table of ten or more rows where a reader may want an order other than the one the author chose. Below that, re-reading the table is cheaper than sorting it. The order you write is still the order that means something: it is what exports and what a reader with no script sees.',
    requires: ['a thead whose cells name what they hold', 'ten or more body rows'],
    variants: ['sf-sort'],
    // Nothing here hides anything, so there is no [data-sf-live] guard to write:
    // sorting reorders rows, it never removes them. The cursor and the marker
    // are the only things that change before the script runs, and both are
    // affordances rather than content.
    // The control is a real <button> the script puts INSIDE the th, never a role
    // on the th itself: a cell that stops being a `columnheader` loses its
    // association with the column and makes `aria-sort` meaningless. The th
    // keeps the sort state, because that is where the attribute belongs; the
    // button is only what a reader presses.
    css: `table.sortable th{white-space:nowrap;padding:0}
table.sortable th .sf-sort{appearance:none;background:none;border:none;width:100%;
  font:inherit;color:inherit;text-align:inherit;cursor:pointer;user-select:none;
  padding:9px 12px;display:flex;align-items:center;gap:7px}
table.sortable th .sf-sort::after{content:"";flex:none;width:0;height:0;opacity:.35;
  border-left:4px solid transparent;border-right:4px solid transparent;
  border-top:5px solid currentColor}
table.sortable th[aria-sort="ascending"] .sf-sort::after{opacity:1;
  border-top:none;border-bottom:5px solid currentColor}
table.sortable th[aria-sort="descending"] .sf-sort::after{opacity:1}
table.sortable th .sf-sort:hover{color:var(--accent)}
table.sortable th .sf-sort:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}`,
    example: `<table class="sortable">
  <thead><tr><th>Component</th><th>Uses</th></tr></thead>
  <tbody>
    <tr><td>callout</td><td>640</td></tr>
    <tr><td>tag</td><td>1298</td></tr>
    <tr><td>panel</td><td>97</td></tr>
  </tbody>
</table>`,
  },
  {
    name: 'expandable', family: 'data', kind: 'class', block: true,
    selector: 'table.expandable',
    layer: 'interactive', needs: 'script', detect: 'table.expandable',
    rule: 'A table whose rows each carry a paragraph or two a reader does not need in order to read the table. The row stays scannable and the detail is one press away. Below about six rows, or where the detail is a single clause, put it in a column instead: a disclosure that hides one sentence costs more attention than it saves.',
    requires: ['a summary row carrying data-sf-row with an id', 'a detail row carrying data-sf-detail with the same id, whose cell spans the table'],
    variants: ['sf-expand', 'sf-detail-body'],
    // The detail row is a real row and is VISIBLE until the script hides it, so
    // a spec opened from file://, printed, or exported to markdown carries every
    // detail in document order. The script reduces a whole document; it never
    // builds one. That is why the [data-sf-live] guard is on the hiding rule
    // rather than on the revealing one.
    //
    // The control is a button injected into the FIRST cell rather than a new
    // leading column: a column would change every colspan in the table and
    // break the detail row's span. It is a thin caret on the text baseline, not
    // a filled triangle floating in the margin: the row is the thing being read
    // and the control qualifies it.
    //
    // The detail body is wrapped in a div by the script, and the wrapper carries
    // `width:0;min-width:100%`. A `max-width` on the cell itself does nothing:
    // under `table-layout:auto` a cell is sized by its content, so the cell
    // grows and takes the table with it. Percentages are ignored while a browser
    // computes intrinsic width, so the wrapper contributes 0 to that pass and is
    // then stretched back to the cell at layout time.
    css: `table.expandable tr[data-sf-row] > td:first-child{white-space:nowrap}
table.expandable .sf-expand{appearance:none;background:none;border:0;cursor:pointer;
  color:var(--muted);padding:0;margin:0 7px 0 0;border-radius:3px;
  width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;
  vertical-align:-2px;transition:color .12s ease,background-color .12s ease}
table.expandable .sf-expand::before{content:"";width:5px;height:5px;
  border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;
  transform:translateX(-1px) rotate(-45deg);transition:transform .15s ease}
table.expandable .sf-expand[aria-expanded="true"]::before{
  transform:translateY(-1px) rotate(45deg)}
table.expandable .sf-expand:hover{color:var(--accent);
  background:color-mix(in srgb,var(--accent) 13%,transparent)}
table.expandable .sf-expand:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
table.expandable tr[data-sf-row]:has(.sf-expand[aria-expanded="true"]) > td{
  background:color-mix(in srgb,var(--accent) 7%,transparent)}
table.expandable tr[data-sf-detail] > td{background:color-mix(in srgb,var(--ink) 3%,transparent);
  border-top:none;padding-left:20px;
  box-shadow:inset 3px 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}
table.expandable .sf-detail-body{width:0;min-width:100%;box-sizing:border-box;
  overflow-wrap:anywhere}
table.expandable .sf-detail-body > :first-child{margin-top:0}
table.expandable .sf-detail-body > :last-child{margin-bottom:0}
table.expandable .sf-detail-body table{width:100%;table-layout:fixed}
table.expandable .sf-detail-body pre{overflow-x:auto;white-space:pre-wrap;word-break:break-word}
[data-sf-live] table.expandable tr[data-sf-detail][hidden]{display:none}
@media print{
  [data-sf-live] table.expandable tr[data-sf-detail][hidden]{display:table-row}
  [data-sf-live] table.expandable .sf-expand{display:none}
}`,
    example: `<table class="expandable">
  <thead><tr><th>ID</th><th>Asset</th><th>Status</th></tr></thead>
  <tbody>
    <tr data-sf-row="a16"><td>A16</td><td>Catalog qualifier</td><td>done</td></tr>
    <tr data-sf-detail="a16"><td colspan="3">Reads /products.json, samples 20 images per store, classifies each against the canonical taxonomy.</td></tr>
  </tbody>
</table>`,
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
